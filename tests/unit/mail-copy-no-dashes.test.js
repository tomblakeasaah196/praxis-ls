"use strict";

/**
 * No em dash in anything mail puts in front of a tenant (CLAUDE.md rule six).
 *
 * Found by the owner on 25 Nov 2026: a new-mail notification for the info@
 * shared mailbox read "We have your message, reference MSG-W8HXYR9P — Hello
 * Joseph". The in-app notification joined subject and preview with a dash; the
 * follow-up reminder and the "why is this in People?" reason did the same.
 * (The SmartLS signature's styled dash is an approved design element and out of
 * scope here.)
 */

const fs = require("fs");
const path = require("path");
const { compose } = require("../../src/modules/mail/mail/mail-notify.service");

const DASH = /—|–| -- /;

describe("the new-mail notification", () => {
  it("joins subject and preview with a full stop", () => {
    const out = compose({
      from: { name: "SMART LOGISTICS AND SERVICES", address: "support@smartlsgroup.com" },
      subject: "We have your message, reference MSG-W8HXYR9P",
      bodyText: "Hello Joseph, thank you for writing.",
      mailboxLabel: "info@smartlsgroup.com",
    });
    expect(out.body).toBe("We have your message, reference MSG-W8HXYR9P. Hello Joseph, thank you for writing.");
    expect(`${out.title} ${out.body}`).not.toMatch(DASH);
  });

  it("does not double a subject's own punctuation", () => {
    const out = compose({ from: { address: "a@b.co" }, subject: "Can you quote?", bodyText: "Two containers." });
    expect(out.body).toBe("Can you quote? Two containers.");
  });
});

describe("mail copy a tenant reads", () => {
  // The template literal or string that BUILDS the copy, not the comments
  // around it, which are out of scope by decision.
  const code = (rel) =>
    fs.readFileSync(path.join(__dirname, "../..", rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it.each([
    "src/modules/mail/mail/mail-notify.service.js",
    "src/modules/mail/triage/followup.service.js",
    "src/modules/mail/mail/stream.js",
    "src/modules/mail/triage/sla.service.js",
    "src/modules/sales/public_intake/enquiry-mail.service.js",
  ])("%s builds no copy with an em dash", (rel) => {
    const strings = code(rel).match(/`[^`]*`|"[^"\n]*"/g) || [];
    expect(strings.filter((s) => /—/.test(s))).toEqual([]);
  });
});
