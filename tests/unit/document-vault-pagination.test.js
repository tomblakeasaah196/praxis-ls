"use strict";

const repo = require("../../src/modules/vault/document_vault/document_vault.repo");

describe("document vault paged listing", () => {
  test("applies list filters before paging and reports the total", async () => {
    const client = {
      query: jest.fn(async () => ({
        rows: [{ doc_id: "doc-1", status: "VERIFIED", _total: "61" }],
      })),
    };

    const result = await repo.listPaged(client, {
      limit: "25",
      offset: "50",
      entity_ref: "case-7",
      doc_type: "invoice",
      status: "VERIFIED",
      q: "bill",
    });

    expect(result).toEqual({
      rows: [{ doc_id: "doc-1", status: "VERIFIED" }],
      total: 61,
    });
    const [sql, params] = client.query.mock.calls[0];
    expect(params).toEqual([25, 50, "case-7", "invoice", "VERIFIED", "%bill%"]);
    expect(sql).toContain("entity_ref = $3");
    expect(sql).toContain("doc_type = $4");
    expect(sql).toContain("status = $5");
    expect(sql).toContain(
      "doc_type ILIKE $6 OR entity_ref ILIKE $6 OR folder_ref ILIKE $6",
    );
    expect(sql).toContain("COUNT(*) OVER() AS _total");
    expect(sql).toContain(
      "ORDER BY created_at DESC, doc_id DESC LIMIT $1 OFFSET $2",
    );
  });

  test("keeps the legacy row-array listing contract", async () => {
    const client = {
      query: jest.fn(async () => ({
        rows: [{ doc_id: "doc-1", _total: "1" }],
      })),
    };

    await expect(repo.list(client, {})).resolves.toEqual([{ doc_id: "doc-1" }]);
    expect(client.query.mock.calls[0][0]).toContain("LIMIT $1 OFFSET $2");
  });
});
