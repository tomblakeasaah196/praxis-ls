/**
 * MAIL AI WRITES THE SUBJECT LINE WHEN THERE IS NONE (27 Nov 2026).
 *
 * The owner: "having drafted a proper mail from a brief, you now have to start
 * thinking about the best subject". When the composer's Subject field is empty
 * it sends `want_subject`, the same model call returns a "Subject:" first line,
 * and the service lifts it out so it lands in the Subject field and never in
 * the body.
 *
 * What must NOT change is pinned as hard as what must: a subject the operator
 * typed is the brief and is never second-guessed, a reply keeps its thread's
 * subject, a translation does not invent one, and a model that forgets the
 * line costs the operator a blank field, not the first line of their email.
 */
"use strict";

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
  resolveActorId: jest.fn(async (_c, id) => id),
}));
jest.mock("../../src/services/ai/llm.service", () => ({
  chat: jest.fn(),
  PRIMARY: "deepseek", FALLBACK: "gemini",
}));
jest.mock("../../src/modules/ai/governance/governance.service", () => ({
  canUseFeature: jest.fn(async () => ({ allowed: true })),
  recordUsage: jest.fn(async () => ({})),
}));
jest.mock("../../src/shared/cache/identity-cache", () => ({
  getGrants: jest.fn(async () => []),
  getUserScopeClosure: jest.fn(async () => []),
}));

const llm = require("../../src/services/ai/llm.service");
const assist = require("../../src/modules/mail/assist/assist.service");

function fakeClient(answers = []) {
  return {
    query: async (text) => {
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  };
}
const ON = { match: /FROM feature_state WHERE feature_key = 'mail\.ai'/, rows: [{ state: "on" }] };
const ME = { user_id: "u-me", role_ids: ["r-1"] };
const systemOf = () => llm.chat.mock.calls[0][0].messages[0].content;
const answer = (text) => llm.chat.mockResolvedValueOnce({ provider: "gemini", text, usage: {} });

const BRIEF = "Ask them to waive the demurrage, we cleared within the free days.";

beforeEach(() => llm.chat.mockReset());

describe("splitting the subject off the model's text", () => {
  test.each([
    ["Subject: Request for a demurrage waiver\n\nDear Sir,\nBody.", "Request for a demurrage waiver", "Dear Sir,\nBody."],
    ["**Objet :** « Demande de dérogation »\nBonjour,", "Demande de dérogation", "Bonjour,"],
    ["\n  Subject: \"Customs cleared.\"\n\nHello", "Customs cleared", "Hello"],
    ["Sujet: Livraison\n\nMadame,", "Livraison", "Madame,"],
  ])("%j", (raw, subject, body) => {
    expect(assist.splitSubject(raw)).toEqual({ subject, body });
  });

  test("a model that forgot the line leaves the body WHOLE and the subject empty", () => {
    const raw = "Dear Sir,\n\nThe container cleared this morning.";
    expect(assist.splitSubject(raw)).toEqual({ subject: null, body: raw });
  });

  test("a 'Subject:' that is not the first line is body text, not a subject", () => {
    const raw = "Dear Sir,\nSubject: as discussed, here are the papers.";
    expect(assist.splitSubject(raw).subject).toBeNull();
  });

  test("an over-long subject is capped rather than refused", () => {
    expect(assist.splitSubject(`Subject: ${"x".repeat(400)}\n\nBody`).subject).toHaveLength(150);
  });
});

describe("compose writes a subject only when the field is empty", () => {
  test("an empty Subject field gets one, and the body does not carry it", async () => {
    answer("Subject: Request for a demurrage waiver\n\nDear Sir,\n\nWe cleared within the free days.");
    const out = await assist.compose(fakeClient([ON]),
      { tone: "formal", instruction: BRIEF, want_subject: true }, ME);
    expect(out.subject_text).toBe("Request for a demurrage waiver");
    expect(out.draft_text).not.toMatch(/Subject/i);
    expect(out.draft_text).toMatch(/^Dear Sir,/);
    expect(systemOf()).toMatch(/Begin with ONE line of the form "Subject: <subject line>"/);
    expect(systemOf()).not.toMatch(/No subject line/);
  });

  test("the subject is asked for in the language the body is written in", async () => {
    answer("Objet: Demande de dérogation\n\nMadame,");
    await assist.compose(fakeClient([ON]),
      { tone: "formal", instruction: BRIEF, want_subject: true, language: "fr" }, ME);
    expect(systemOf()).toMatch(/"Objet: <subject line>"/);
    expect(systemOf()).toMatch(/subject line is in French/);
  });

  test("a subject the operator TYPED is the brief, never replaced", async () => {
    answer("Dear Sir,\n\nBody.");
    const out = await assist.compose(fakeClient([ON]),
      { tone: "formal", subject: "Demurrage MSKU4567890", want_subject: true }, ME);
    expect(out.subject_text).toBeNull();
    expect(systemOf()).toMatch(/No subject line/);
    expect(systemOf()).toMatch(/already written: "Demurrage MSKU4567890"/);
  });

  test("without want_subject nothing changes: the body only, as before", async () => {
    answer("Subject: Something\n\nDear Sir,");
    const out = await assist.compose(fakeClient([ON]), { tone: "formal", instruction: BRIEF }, ME);
    expect(out.subject_text).toBeNull();
    // Not asked for, so not stripped either: the text is the model's own.
    expect(out.draft_text).toMatch(/^Subject: Something/);
    expect(systemOf()).toMatch(/No subject line/);
  });

  test("a translation never invents a subject", async () => {
    answer("Bonjour,");
    const out = await assist.compose(fakeClient([ON]),
      { action: "to_fr", draft: "Hello, the container cleared.", want_subject: true }, ME);
    expect(out.subject_text).toBeNull();
    expect(systemOf()).not.toMatch(/Begin with ONE line/);
  });

  test("an invented reference in the SUBJECT is fenced like one in the body", async () => {
    answer("Subject: Invoice INV-2026-00917 overdue\n\nDear Sir,\n\nPlease pay.");
    const out = await assist.compose(fakeClient([ON]),
      { tone: "payment", instruction: "Chase the payment", want_subject: true }, ME);
    expect(out.subject_text).toBe("Invoice INV-2026-00917 overdue");
    expect(out.fence.ok).toBe(false);
    expect(out.fence.violations).toContain("INV-2026-00917");
    expect(out.needs_review).toBe(true);
  });
});

describe("dictation writes a subject too, when asked", () => {
  test("Make It an Email on a new mail fills the empty subject", async () => {
    answer("Subject: Container cleared customs\n\nDear Sir,\n\nThe container cleared customs this morning.");
    const out = await assist.voice(fakeClient([ON]),
      { transcript: "tell them the container cleared customs this morning", wantSubject: true }, ME);
    expect(out.subject_text).toBe("Container cleared customs");
    expect(out.draft_text).toMatch(/^Dear Sir,/);
  });

  test("and leaves it alone when not asked", async () => {
    answer("Dear Sir,\n\nThe container cleared.");
    const out = await assist.voice(fakeClient([ON]), { transcript: "tell them it cleared" }, ME);
    expect(out.subject_text).toBeNull();
    expect(systemOf()).toMatch(/No subject line/);
  });
});
