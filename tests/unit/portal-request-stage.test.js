"use strict";

/**
 * Lean revamp PR 6 (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.8, §4.2): the
 * client portal reads a quote request's STAGE, never the retiring `status`,
 * and nothing in it reads a proposal any more (every one became a quotation,
 * 14542). The one request view is `quote_request.clientView`, which reads the
 * stage itself; these pin the portal's own reads.
 */

const fs = require("fs");
const path = require("path");

describe("the list reads stage, not status", () => {
  test("the portal's request list selects quote_request.stage", () => {
    const src = fs.readFileSync(require.resolve("../../src/modules/portal/portal.repo.js"), "utf8");
    const list = src.slice(src.indexOf("async function clientQuoteRequests"), src.indexOf("async function clientQuoteRequests") + 400);
    expect(list).toMatch(/q\.stage\b/);
    expect(list).not.toMatch(/q\.status\b/);
  });

  test("no portal file reads quote_request.status or offers a proposal any more", () => {
    const dir = path.join(__dirname, "../../src/modules/portal");
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect([f, /portal_proposal/.test(src)]).toEqual([f, false]);
      expect([f, /FROM proposal\b|JOIN proposal\b/.test(src)]).toEqual([f, false]);
    }
    expect(fs.existsSync(path.join(dir, "portal_proposal.service.js"))).toBe(false);
  });
});
