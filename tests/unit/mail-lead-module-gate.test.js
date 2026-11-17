"use strict";
/**
 * Gap 11 of the Sales lean revamp (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §1.3):
 * mail checked the WRONG permission for leads.
 *
 * `mail-context.service.js` resolved a bound thread's lead name, and
 * `convert.service.js` greyed "turn this mail into a lead", under MOD-26 —
 * which is the Project Portfolio Builder (Success Stories), not leads. So a
 * person who works leads (MOD-20) saw a bound thread's raw ref and could not
 * turn a mail into a lead, while a person who only curates case stories saw the
 * company's name and could. The Lead 360's Activity timeline reads those bound
 * threads, which is why PR 2 fixes it.
 *
 * Both now gate on MOD-20, the module the lead and request routes are under.
 */
jest.mock("../../src/shared/cache/identity-cache", () => ({ getGrants: jest.fn() }));

const identityCache = require("../../src/shared/cache/identity-cache");
const mailContext = require("../../src/modules/mail/binding/mail-context.service");
const convert = require("../../src/modules/mail/binding/convert.service");

const LEAD = "11111111-1111-4111-8111-111111111111";
const REF = `lead:${LEAD}`;

/** A client that answers the label read with the company's name. */
const client = {
  query: jest.fn(async (sql) => (/FROM lead/.test(sql) ? { rows: [{ id: LEAD, label: "Sahel Traders" }] } : { rows: [] })),
};

/** The caller holds `view` (can_read) on exactly these modules. */
function grantsOn(...modules) {
  identityCache.getGrants.mockImplementation(async (_c, { module }) =>
    modules.includes(module) ? [{ can_read: true }] : []);
}

const user = { user_id: "U1", role_ids: ["R1"] };

beforeEach(() => jest.clearAllMocks());

describe("gap 11 — a bound thread's lead name is gated on MOD-20", () => {
  test("someone who works leads (MOD-20) sees the company's name", async () => {
    grantsOn("MOD-20");
    await expect(mailContext.labelForRefs(client, [REF], user)).resolves.toEqual({ [REF]: "Sahel Traders" });
    expect(identityCache.getGrants).toHaveBeenCalledWith(client, expect.objectContaining({ module: "MOD-20" }));
  });

  test("someone who only curates Success Stories (MOD-26) does not", async () => {
    grantsOn("MOD-26");
    await expect(mailContext.labelForRefs(client, [REF], user)).resolves.toEqual({});
    expect(identityCache.getGrants).not.toHaveBeenCalledWith(client, expect.objectContaining({ module: "MOD-26" }));
  });
});

describe("gap 11 — turning a mail into a lead or a request needs the lead module's rights", () => {
  test("both targets are MOD-20's, the module their routes are under", () => {
    expect(convert.TARGETS.lead.module).toBe("MOD-20");
    expect(convert.TARGETS.quote_request.module).toBe("MOD-20");
    const leadRoutes = require("fs").readFileSync(require("path").join(__dirname, "../../src/modules/sales/lead/lead.routes.js"), "utf8");
    expect(leadRoutes).toMatch(/const MODULE = "MOD-20"/);
  });
});
