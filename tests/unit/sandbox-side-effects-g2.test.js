"use strict";

/**
 * G2 — sandbox side-effect guards (PRD §5.5 [RULE]: Test mode sends no real
 * client emails, spends no real AI money, and watermarks PDFs).
 *
 * The three legs, each with its own test:
 *   1. email.service.send suppresses (and logs SUPPRESSED) when the connection
 *      is env-tagged sandbox — no transport resolved, nothing leaves.
 *   2. The watermark decision helper forces TEST SANDBOX on sandbox renders
 *      and keeps the tenant's watermark on live.
 *   3. The AI generators already take the mock/manual path in sandbox (the
 *      proposal generator asserts this here); the sandbox flag means no
 *      governance spend is recorded.
 */

jest.mock("../../src/services/email.repo", () => ({
  identityFor: jest.fn(),
  identityForSection: jest.fn(),
  recordSend: jest.fn(async () => ({ email_send_id: "log-1" })),
}));

const emailRepo = require("../../src/services/email.repo");
const email = require("../../src/services/email.service");
const kit = require("../../src/services/documents/templates/kit");

const ENV = Symbol.for("praxis.conn.env");

const sandboxClient = () => ({ [ENV]: "sandbox" });
// A real pooled client responds to query; resolveMail reads settings through it.
const liveClient = () => ({
  [ENV]: "live",
  query: async () => ({ rows: [] }),
});

describe("G2 leg 1 — sandbox emails are suppressed", () => {
  beforeEach(() => {
    emailRepo.recordSend.mockClear();
  });

  it("suppresses a sandbox send without resolving any transport", async () => {
    // No SMTP configured anywhere — if the guard works, send() never tries.
    const out = await email.send(sandboxClient(), {
      to: "client@example.com",
      subject: "Final invoice SLAS-INV-2026-0012",
      purpose: "INVOICE",
    });
    expect(out.suppressed).toBe(true);
    expect(out.env).toBe("sandbox");
    // Logged as SUPPRESSED so the trail shows what would have gone out.
    expect(emailRepo.recordSend).toHaveBeenCalledTimes(1);
    expect(emailRepo.recordSend.mock.calls[0][1].status).toBe("SUPPRESSED");
    // identityFor must never run: resolving a sender identity is the first
    // step toward actually sending, and it must not happen for a suppress.
    expect(emailRepo.identityFor).not.toHaveBeenCalled();
  });

  it("sends normally on a live connection (guard does not widen)", async () => {
    // live client with no SMTP → the ordinary "no sender configured" error,
    // proving the guard only fires in sandbox and does not swallow live sends.
    await expect(
      email.send(liveClient(), { to: "client@example.com", subject: "x" }),
    ).rejects.toThrow(/no sender configured/i);
    expect(emailRepo.recordSend).not.toHaveBeenCalled();
  });
});

describe("G2 leg 2 — sandbox renders are watermarked", () => {
  it("forces TEST SANDBOX on a sandbox connection", () => {
    expect(kit.watermarkFor(sandboxClient(), "ACME")).toBe("TEST SANDBOX");
    expect(kit.watermarkFor(sandboxClient(), "")).toBe("TEST SANDBOX");
  });

  it("keeps the tenant's watermark on a live connection", () => {
    expect(kit.watermarkFor(liveClient(), "ACME")).toBe("ACME");
    expect(kit.watermarkFor(liveClient(), "")).toBe("");
  });
});

describe("G2 leg 3 — AI generators take the mock path in sandbox", () => {
  it("Draft With AI on a quotation writes the discovery prefill and calls no provider in sandbox", async () => {
    // Moved from the proposal generator with the proposal (lean revamp PR 4).
    // The sandbox branch must never reach the model: pinning it here means a
    // refactor cannot silently route TEST through the live provider.
    jest.resetModules();
    jest.doMock("../../src/modules/commercial/quotation/quotation.repo", () => ({
      get: jest.fn().mockResolvedValue({ quotation_id: "q1", status: "DRAFT", lead_id: null, client_id: null }),
      listSections: jest.fn().mockResolvedValue([]),
      upsertSection: jest.fn().mockResolvedValue(undefined),
    }));
    const llm = { chat: jest.fn() };
    jest.doMock("../../src/services/ai/llm.service", () => llm);
    jest.doMock("../../src/shared/events/emit", () => ({ audit: jest.fn(), emitEvent: jest.fn() }));
    const generator = require("../../src/modules/commercial/quotation/quotation.generator");
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const out = await generator.draft(client, { quotationId: "q1", input: { client_operations: "ops", proposed_strategy: "plan" }, env: "sandbox" });
    expect(out).toMatchObject({ manual_required: true, provider: "mock", sandbox: true });
    expect(llm.chat).not.toHaveBeenCalled();
    jest.dontMock("../../src/modules/commercial/quotation/quotation.repo");
    jest.dontMock("../../src/services/ai/llm.service");
    jest.dontMock("../../src/shared/events/emit");
  });
});
