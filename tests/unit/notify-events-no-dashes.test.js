"use strict";

/**
 * No em dash in an event notification a tenant reads (CLAUDE.md rule six).
 *
 * The owner's bell on 25 Nov 2026 read "New enquiry — Contact enquiry
 * 87817c1a.": the shared event-notification builder joined the title and the
 * record with an em dash, for every event it announces. It joins them with a
 * colon now, and this test runs every title in NOTIFIABLE through it.
 */

const { composeBody, NOTIFIABLE } = require("../../src/shared/notifications/notify-events");
const clientTeam = require("../../src/shared/notifications/notify-client-team");

const DASH = /—|–/;

describe("event notification bodies", () => {
  it("joins the title and the record with a colon", () => {
    expect(composeBody({ title: "New enquiry", entityRef: "contact_enquiry:87817c1a-0000-4000-8000-000000000000" }))
      .toBe("New enquiry: Contact enquiry 87817c1a.");
  });

  it("keeps the amount and who did it, still without a dash", () => {
    const body = composeBody({
      title: "Invoice paid",
      entityRef: "final_invoice:abc",
      payload: { amount_xaf: 1250000, by: { name: "Paul Atiock", email: "paul@goum.cm" } },
    });
    expect(body).toBe("Invoice paid: Final invoice abc (1,250,000 XAF). From Paul Atiock (paul@goum.cm).");
  });

  it.each(Object.entries(NOTIFIABLE))("%s carries no em dash, title or body", (_key, cfg) => {
    const body = composeBody({
      title: cfg.title,
      entityRef: "contact_enquiry:87817c1a-0000-4000-8000-000000000000",
      payload: { amount_xaf: 1000, by: { name: "A Person", email: "a@b.co" } },
    });
    expect(cfg.title).not.toMatch(DASH);
    expect(body).not.toMatch(DASH);
  });

  it("the client-activity alerts carry no em dash either", () => {
    const p = { by: { name: "A Person", email: "a@b.co" }, doc_number: "QT-1", reason: "Too dear", amount: 1000, currency: "XAF", kind: "FILE" };
    for (const [key, cfg] of Object.entries(clientTeam.EVENTS)) {
      const title = typeof cfg.title === "function" ? cfg.title("Acme", p) : String(cfg.title || "");
      const body = typeof cfg.body === "function" ? cfg.body(p) : String(cfg.body || "");
      expect([key, title, body].join(" ")).not.toMatch(DASH);
    }
  });
});
