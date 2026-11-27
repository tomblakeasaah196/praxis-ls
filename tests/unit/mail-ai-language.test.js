/**
 * MAIL AI WRITES IN THE LANGUAGE OF THE CONVERSATION, ON GEMINI.
 *
 * Two owner complaints, one file.
 *
 * LANGUAGE. The assistant took its language from the bound client's
 * `preferred_language` and never looked at the mail itself. `signature/
 * language.js` names "message language — detected per inbound message" as a
 * third axis, and nothing implemented it. So a client recorded as "en" who
 * wrote in French got an English reply, every time. The owner's rule: "If a
 * mail comes in French it drafts in French, if it comes in English it drafts
 * in English. Let it follow the previous mails."
 *
 * The detector half is tested on the shapes real mail takes, above all the one
 * that defeats a naive count: a short French reply sitting on top of a long
 * quoted English history. The resolution half is tested through the service,
 * because a correct detector that the draft path does not consult is the same
 * defect with better test coverage.
 *
 * VENDOR. The tenant judged DeepSeek's drafts poor. Mail generation is pinned
 * to Gemini with DeepSeek as the fallback hop, and asserted at the one call
 * site, since that is the only place it can be lost.
 */
"use strict";

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
  resolveActorId: jest.fn(async (_c, id) => id),
}));
jest.mock("../../src/services/ai/llm.service", () => ({
  chat: jest.fn(async () => ({ provider: "gemini", text: "Bonjour.", usage: {} })),
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
const governance = require("../../src/modules/ai/governance/governance.service");
const assist = require("../../src/modules/mail/assist/assist.service");
const {
  detectLanguage, conversationLanguage, authoredText,
  resolveDraftLanguage, resolveRewriteLanguage,
} = require("../../src/modules/mail/assist/assist.language");

/* ── Fixtures: real-shaped mail ───────────────────────────────────────────── */

const FR_MAIL = [
  "Bonjour Monsieur,",
  "",
  "Nous avons bien reçu votre facture et nous vous en remercions. Pourriez-vous",
  "nous confirmer la date d’arrivée du conteneur à Douala ?",
  "",
  "Cordialement,",
  "Jean Mbarga",
].join("\n");

const EN_MAIL = [
  "Hi Jean,",
  "",
  "Please find attached the invoice for the shipment. We will confirm the ETA as",
  "soon as the vessel has berthed at Douala.",
  "",
  "Best regards,",
  "John",
].join("\n");

const FR_REPLY_ON_EN_HISTORY = [
  "Bonjour,",
  "",
  "C’est noté, merci. Nous revenons vers vous avec les documents.",
  "",
  "On Mon, 3 Nov 2026 at 10:00, John Smith <john@example.com>",
  "wrote:",
  "> Hi Jean,",
  "> Please find attached the invoice for the shipment. We will confirm the ETA",
  "> as soon as the vessel has berthed and the customs release is done.",
  "> Could you please send the packing list and the bill of lading for the shipment?",
  "> Best regards,",
  "> John",
].join("\n");

/* ── 1. The detector ──────────────────────────────────────────────────────── */

describe("detectLanguage", () => {
  test("a French business mail is French", () => {
    expect(detectLanguage(FR_MAIL)).toBe("fr");
  });

  test("an English business mail is English", () => {
    expect(detectLanguage(EN_MAIL)).toBe("en");
  });

  test("a French reply quoting English history is French", () => {
    // The case a naive word count gets wrong: the quoted English outweighs the
    // three-line French answer, and the answer is what was written today.
    expect(detectLanguage(FR_REPLY_ON_EN_HISTORY)).toBe("fr");
  });

  test("the French attribution line cuts history too", () => {
    const en = [
      "Thanks, we will send the packing list to you today with the bill of lading.",
      "",
      "Le lun. 3 nov. 2026 à 10:00, Jean Mbarga <jean@example.cm> a écrit :",
      "> Bonjour, nous attendons toujours la liste de colisage et le connaissement pour le dossier.",
      "> Pourriez-vous nous les transmettre dès que possible ? Merci d’avance.",
    ].join("\n");
    expect(detectLanguage(en)).toBe("en");
  });

  test("an Outlook header block cuts history", () => {
    const fr = [
      "Merci pour votre retour, je regarde cela avec l’équipe.",
      "",
      "From: John Smith",
      "Sent: Monday, 3 November 2026 10:00",
      "To: Jean Mbarga",
      "Subject: ETA",
      "",
      "The vessel is delayed and we will update you with the new ETA as soon as we have it.",
    ].join("\n");
    expect(detectLanguage(fr)).toBe("fr");
  });

  test("an English disclaimer under a French sign-off does not vote", () => {
    const fr = [
      FR_MAIL,
      "This email and any attachments are confidential and intended for the addressee only.",
      "If you have received it in error, please notify the sender and delete it from your system.",
      "Any use of this email by anyone else is prohibited and may be unlawful.",
    ].join("\n");
    expect(authoredText(fr)).not.toMatch(/confidential/);
    expect(detectLanguage(fr)).toBe("fr");
  });

  test("a greeting followed by 'Thanks!' is not mistaken for the end of the mail", () => {
    const en = "Hello,\nThanks!\nWe received the documents and will send the invoice to you today.";
    expect(detectLanguage(en)).toBe("en");
  });

  test.each([
    ["empty", ""],
    ["null", null],
    ["a one-word acknowledgement", "OK"],
    ["two words", "Merci, noted."],
    ["a reference and nothing else", "SLAS-2026-0042 / INV-2026-0311"],
  ])("too short to call (%s) is null, not a guess", (_label, text) => {
    // A confident wrong answer overrides the client's recorded preference, so
    // "cannot tell" must stay "cannot tell".
    expect(detectLanguage(text)).toBeNull();
  });

  test("an even bilingual split is null", () => {
    expect(detectLanguage("Bonjour, merci pour votre mail. Thanks for the update, we will check it.")).toBeNull();
  });

  test("accents are a signal, but one accented name does not make English French", () => {
    expect(detectLanguage("Réception confirmée. Expédition prévue vendredi. Dédouanement terminé.")).toBe("fr");
    expect(detectLanguage("Hélène asked us to send the invoice for the shipment to the café.")).toBe("en");
  });

  test("URLs and addresses do not vote", () => {
    // "le-transporteur.fr" and "des" in a path would otherwise read as French.
    const en = "Please see https://le-transporteur.fr/des/la/les/du and write to le.chef@des-la.fr for the documents.";
    expect(detectLanguage(en)).toBe("en");
  });
});

/* ── 2. The conversation's language ───────────────────────────────────────── */

describe("conversationLanguage", () => {
  const IN = (body_text) => ({ direction: "IN", body_text });
  const OUT = (body_text) => ({ direction: "OUT", body_text });

  test("the most recent inbound message with a confident reading wins", () => {
    expect(conversationLanguage([IN(EN_MAIL), OUT(EN_MAIL), IN(FR_MAIL)])).toBe("fr");
    expect(conversationLanguage([IN(FR_MAIL), IN(EN_MAIL)])).toBe("en");
  });

  test("an inbound 'OK' does not hide the client's last real message", () => {
    expect(conversationLanguage([IN(FR_MAIL), OUT(EN_MAIL), IN("OK")])).toBe("fr");
  });

  test("inbound beats a more recent outbound: we answer them, in their language", () => {
    expect(conversationLanguage([IN(FR_MAIL), OUT(EN_MAIL)])).toBe("fr");
  });

  test("with no readable inbound, the most recent message of either direction decides", () => {
    expect(conversationLanguage([OUT(EN_MAIL), OUT(FR_MAIL), IN("OK")])).toBe("fr");
  });

  test("nothing readable is null", () => {
    expect(conversationLanguage([IN("OK"), OUT("Noted.")])).toBeNull();
    expect(conversationLanguage([])).toBeNull();
    expect(conversationLanguage(undefined)).toBeNull();
  });
});

/* ── 3. The resolution orders ─────────────────────────────────────────────── */

describe("resolution order", () => {
  test("drafting: explicit, then conversation, then party, then en", () => {
    expect(resolveDraftLanguage({ explicit: "en", conversation: "fr", party: "fr" }))
      .toEqual({ language: "en", source: "explicit" });
    expect(resolveDraftLanguage({ conversation: "fr", party: "en" }))
      .toEqual({ language: "fr", source: "conversation" });
    expect(resolveDraftLanguage({ conversation: null, party: "fr" }))
      .toEqual({ language: "fr", source: "party" });
    expect(resolveDraftLanguage({})).toEqual({ language: "en", source: "default" });
  });

  test("rewriting: the text's own language comes before the conversation", () => {
    expect(resolveRewriteLanguage({ text: "en", conversation: "fr", party: "fr" }))
      .toEqual({ language: "en", source: "text" });
    expect(resolveRewriteLanguage({ explicit: "fr", text: "en" }))
      .toEqual({ language: "fr", source: "explicit" });
    expect(resolveRewriteLanguage({ text: null, conversation: "fr", party: "en" }))
      .toEqual({ language: "fr", source: "conversation" });
  });

  test("the shared resolveLanguage order is untouched: party still beats the replied message", () => {
    // Signatures and templates depend on this; mail assist has its own order
    // rather than a changed global one.
    const { resolveLanguage } = require("../../src/modules/mail/signature/language");
    expect(resolveLanguage({ partyLanguage: "en", repliedMessageLanguage: "fr" })).toBe("en");
  });
});

/* ── 4. Through the service ───────────────────────────────────────────────── */

function fakeClient(answers = []) {
  return {
    query: async (text) => {
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  };
}

const ON = { match: /FROM feature_state WHERE feature_key = 'mail\.ai'/, rows: [{ state: "on" }] };
// An unbound thread on a client whose card says English: the party rung is
// "en", so any French in the output has to have come from the conversation.
const THREAD_EN_CLIENT = {
  match: /FROM email_thread t/,
  rows: [{ email_thread_id: "t-1", subject: "ETA", entity_ref: null, client_language: "en" }],
};
const MESSAGES = (...rows) => ({ match: /FROM email_message\s+WHERE email_thread_id/, rows });
const FRENCH_THREAD = MESSAGES(
  { direction: "OUT", from_address: "ops@praxis.cm", body_text: EN_MAIL },
  { direction: "IN", from_address: "jean@client.cm", body_text: FR_REPLY_ON_EN_HISTORY },
);

const ME = { user_id: "u-me", role_ids: ["r-1"] };
const systemOf = (i = 0) => llm.chat.mock.calls[i][0].messages[0].content;

beforeEach(() => {
  jest.clearAllMocks();
  governance.canUseFeature.mockResolvedValue({ allowed: true });
  llm.chat.mockResolvedValue({ provider: "gemini", text: "Bonjour.", usage: {} });
});

describe("the draft follows the conversation", () => {
  test("a French inbound mail on an 'en' client drafts in French", async () => {
    const out = await assist.draft(fakeClient([ON, THREAD_EN_CLIENT, FRENCH_THREAD]), { threadId: "t-1" }, ME);
    expect(out.language).toBe("fr");
    expect(out.language_source).toBe("conversation");
    expect(systemOf()).toMatch(/Write in French\./);
    // The tone preset is in the reply's language too, not just the one line.
    expect(systemOf()).toMatch(/Rédigez un courriel formel/);
  });

  test("an English inbound mail on an 'fr' client drafts in English", async () => {
    const thread = { ...THREAD_EN_CLIENT, rows: [{ ...THREAD_EN_CLIENT.rows[0], client_language: "fr" }] };
    const out = await assist.draft(fakeClient([ON, thread, MESSAGES({ direction: "IN", body_text: EN_MAIL })]),
      { threadId: "t-1" }, ME);
    expect(out.language).toBe("en");
    expect(systemOf()).toMatch(/Write in English\./);
  });

  test("an explicit choice in the composer still wins", async () => {
    const out = await assist.draft(fakeClient([ON, THREAD_EN_CLIENT, FRENCH_THREAD]),
      { threadId: "t-1", language: "en" }, ME);
    expect(out.language).toBe("en");
    expect(out.language_source).toBe("explicit");
    expect(systemOf()).toMatch(/Write in English\./);
  });

  test("a thread too short to read falls back to the client's preferred language", async () => {
    const out = await assist.draft(fakeClient([ON, THREAD_EN_CLIENT, MESSAGES({ direction: "IN", body_text: "OK" })]),
      { threadId: "t-1" }, ME);
    expect(out.language).toBe("en");
    expect(out.language_source).toBe("party");
  });

  test("compose on a thread follows the conversation too", async () => {
    const out = await assist.compose(fakeClient([ON, THREAD_EN_CLIENT, FRENCH_THREAD]),
      { tone: "formal", thread_id: "t-1" }, ME);
    expect(out.language).toBe("fr");
    expect(systemOf()).toMatch(/Write in French\./);
  });

  test("dictation in English on a French thread becomes a French email", async () => {
    const out = await assist.voice(fakeClient([ON, THREAD_EN_CLIENT, FRENCH_THREAD]),
      { threadId: "t-1", transcript: "tell them the container cleared customs this morning and we will deliver it" }, ME);
    expect(out.language).toBe("fr");
  });
});

describe("a rewrite keeps the language of the text", () => {
  const EN_TEXT = "We have received your documents and we will send the invoice to you today. Please confirm the delivery address.";

  test("English text in a French thread stays English", async () => {
    const out = await assist.rewrite(fakeClient([ON, THREAD_EN_CLIENT, FRENCH_THREAD]),
      { threadId: "t-1", text: EN_TEXT, action: "shorten" }, ME);
    expect(out.language).toBe("en");
    expect(out.language_source).toBe("text");
    expect(systemOf()).toMatch(/Write in English\./);
  });

  test("text too short to read takes the conversation's language", async () => {
    const out = await assist.rewrite(fakeClient([ON, THREAD_EN_CLIENT, FRENCH_THREAD]),
      { threadId: "t-1", text: "ok noted", action: "expand" }, ME);
    expect(out.language).toBe("fr");
    expect(out.language_source).toBe("conversation");
  });

  test("'Rewrite in this tone' on the operator's English draft stays English", async () => {
    const out = await assist.compose(fakeClient([ON, THREAD_EN_CLIENT, FRENCH_THREAD]),
      { tone: "friendly", thread_id: "t-1", draft: EN_TEXT }, ME);
    expect(out.language).toBe("en");
  });

  test("a translation action writes in its target, whatever the text or thread", async () => {
    const out = await assist.rewrite(fakeClient([ON, THREAD_EN_CLIENT]),
      { threadId: "t-1", text: EN_TEXT, action: "to_fr" }, ME);
    expect(out.language).toBe("fr");
    // Before, an 'en' client produced "Write in English" beside "Translate to
    // French" in the same system message.
    expect(systemOf()).toMatch(/Write in French\./);
    expect(systemOf()).not.toMatch(/Write in English\./);
  });
});

/* ── 5. The vendor ────────────────────────────────────────────────────────── */

describe("mail generation is pinned to Gemini, DeepSeek as fallback", () => {
  test.each([
    ["draft", () => assist.draft(fakeClient([ON, THREAD_EN_CLIENT, FRENCH_THREAD]), { threadId: "t-1" }, ME)],
    ["compose", () => assist.compose(fakeClient([ON]), { tone: "formal", subject: "ETA" }, ME)],
    ["rewrite", () => assist.rewrite(fakeClient([ON]), { text: "hello", action: "grammar" }, ME)],
    ["translate", () => assist.translate(fakeClient([ON]), { text: "hello", to: "fr" }, ME)],
    ["voice", () => assist.voice(fakeClient([ON]), { transcript: "tell them it cleared" }, ME)],
  ])("%s asks for gemini first and deepseek second", async (_fn, run) => {
    await run();
    expect(llm.chat).toHaveBeenCalledWith(expect.objectContaining({
      vendorName: "gemini", fallbackVendor: "deepseek",
    }));
  });

  test("the pin is one named constant", () => {
    expect(assist.MAIL_VENDOR).toEqual({ vendorName: "gemini", fallbackVendor: "deepseek" });
  });
});
