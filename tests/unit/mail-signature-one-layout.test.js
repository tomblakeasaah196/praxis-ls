"use strict";
/**
 * ONE SIGNATURE FOR THE COMPANY (tenant decision, 17 Nov 2026).
 *
 * Two rules, both of which fail silently when they regress:
 *
 *   1. A person's DEPARTMENT does not choose their signature layout. Five
 *      departments used to be seeded onto their own templates, so the layout
 *      the company picked reached only the staff outside them. If the lookup
 *      comes back, nothing errors: Sales just starts sending a different card
 *      from everyone else again.
 *   2. Choosing the company layout is a SWAP, in one transaction. The database
 *      allows one default per scope, so the old one has to be cleared first,
 *      and a failure between the two statements must leave the company with
 *      the default it had rather than with none.
 */
const repo = require("../../src/modules/mail/signature/signature.repo");

/** A client that records what it was asked and answers from a script. */
function fakeClient(answer = () => ({ rows: [] })) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      return answer(String(sql), params) || { rows: [] };
    },
  };
}

describe("a department does not choose the signature layout", () => {
  test("NO DEPARTMENT LOOKUP IS MADE, whatever department the person is in", async () => {
    const client = fakeClient((sql) =>
      /scope_kind = 'TENANT'/.test(sql) ? { rows: [{ key: "signature_card" }] } : { rows: [] });
    const t = await repo.defaultTemplate(client, { department: "Finance" });
    expect(t).toEqual({ key: "signature_card" });
    expect(client.calls.some((c) => /DEPARTMENT/.test(c.sql))).toBe(false);
    // And "Finance" never reaches the driver as a parameter of anything.
    expect(client.calls.some((c) => (c.params || []).includes("Finance"))).toBe(false);
  });

  test("a second legal entity still gets its own, ahead of the company's", async () => {
    const client = fakeClient((sql) =>
      /scope_kind = 'ENTITY'/.test(sql) ? { rows: [{ key: "entity_b" }] } : { rows: [{ key: "signature_card" }] });
    const t = await repo.defaultTemplate(client, { department: "Sales", entityId: "e-2" });
    expect(t).toEqual({ key: "entity_b" });
  });

  test("with neither, everyone gets the company default", async () => {
    const client = fakeClient(() => ({ rows: [{ key: "signature_card" }] }));
    expect(await repo.defaultTemplate(client, {})).toEqual({ key: "signature_card" });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].sql).toMatch(/scope_kind = 'TENANT'/);
  });
});

describe("choosing the company layout is a swap", () => {
  test("CLEARS THE OLD DEFAULT BEFORE SETTING THE NEW ONE, in one transaction", async () => {
    const client = fakeClient((sql) =>
      /RETURNING \*/.test(sql) ? { rows: [{ signature_template_id: "t-new", is_default: true }] } : { rows: [] });
    const row = await repo.setCompanyDefault(client, "t-new");
    expect(row).toEqual({ signature_template_id: "t-new", is_default: true });

    const order = client.calls.map((c) => c.sql);
    expect(order[0]).toBe("BEGIN");
    expect(order[1]).toMatch(/SET is_default = false/);
    // Every OTHER company default, never the one being chosen.
    expect(order[1]).toMatch(/signature_template_id <> \$1/);
    expect(order[2]).toMatch(/SET is_default = true/);
    expect(order[3]).toBe("COMMIT");
  });

  test("the chosen layout becomes company-wide, even if it was a department's", async () => {
    // Formal / legal is seeded as Finance's. Choosing it for the company must
    // move its scope, or it would be a second DEPARTMENT default nobody reads.
    const client = fakeClient();
    await repo.setCompanyDefault(client, "t-formal");
    const set = client.calls.find((c) => /SET is_default = true/.test(c.sql));
    expect(set.sql).toMatch(/scope_kind = 'TENANT'/);
    expect(set.sql).toMatch(/scope_value = NULL/);
  });

  test("A FAILURE ROLLS BACK, so the company is never left with no default", async () => {
    const client = fakeClient((sql) => {
      if (/SET is_default = true/.test(sql)) throw new Error("connection lost");
      return { rows: [] };
    });
    await expect(repo.setCompanyDefault(client, "t-new")).rejects.toThrow("connection lost");
    const order = client.calls.map((c) => c.sql);
    expect(order[order.length - 1]).toBe("ROLLBACK");
    expect(order).not.toContain("COMMIT");
  });
});
