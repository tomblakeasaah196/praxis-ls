/**
 * WHICH LANGUAGE A MAIL DRAFT IS WRITTEN IN.
 *
 * `signature/language.js` names three language axes and says they must not be
 * conflated: the operator's UI language, the recipient's preferred_language,
 * and the language of the MESSAGE. The third axis was named and never built, so
 * the mail assistant resolved its language from the bound client's
 * `preferred_language` alone. A client recorded as "en" who writes in French got
 * an English reply, every time, and nothing in the thread could change it.
 *
 * The owner's rule is the one a person would follow: "If a mail comes in French
 * it drafts in French, if it comes in English it drafts in English. Let it
 * follow the previous mails." This file is that rule, as two pure parts:
 *
 *   · `detectLanguage(text)` — en / fr / null, from the AUTHORED part of one
 *     message (quoted history and signature blocks removed first).
 *   · the resolvers below it, which put the detected conversation language in
 *     its place in the order.
 *
 * ── WHY NOT `resolveLanguage` ───────────────────────────────────────────────
 *
 * `resolveLanguage` ranks the party's preferred_language ABOVE the replied
 * message's language, and signatures and templates depend on that (an invoice
 * template follows the client's setting, not whatever language their last email
 * happened to be in; tests/unit/signature-language.test.js pins it). A reply is
 * different: it answers a person who just wrote in a language, and answering in
 * another one is the defect. So mail assist has its own order here rather than
 * a changed global one, and reuses `asLang` so "FR-fr" means the same thing on
 * both sides.
 *
 * ── WHY A STOPWORD COUNT AND NOT A LIBRARY ──────────────────────────────────
 *
 * Only two languages are supported, and business mail in either is dense with
 * function words (le, la, des, nous, vous / the, and, we, you, please). Counting
 * them separates the two reliably on a few sentences, needs no dependency, and
 * is fully explainable when an operator asks why a reply came out in French.
 * What it must NOT do is guess: a two-word "Merci, noted" or a bilingual
 * one-liner returns null, and the caller falls back to the next rung. A wrong
 * confident answer is worse than no answer, because it overrides the client's
 * recorded preference.
 *
 * PURE. No I/O.
 */
"use strict";

const { asLang } = require("../signature/language");

/* ── Stripping what the sender did not write in this message ──────────────── */

/**
 * Markers after which everything is quoted history or a forwarded copy.
 *
 * This is the case that matters most: a French reply on top of an English
 * thread carries the whole English history underneath it, which outweighs a
 * three-line French answer by word count. Scored as-is, that reply reads as
 * English. Each marker is anchored to the start of a line, so a sentence that
 * merely mentions "wrote" or "From:" mid-paragraph does not cut the body.
 */
const HISTORY_MARKERS = [
  // Gmail / Apple Mail, which wrap a long attribution onto a second line.
  /^[ \t]*On\b[^\n]{0,300}(?:\n[^\n]{0,300})?\bwrote:[ \t]*$/im,
  /^[ \t]*Le\b[^\n]{0,300}(?:\n[^\n]{0,300})?\ba [ée]crit[ \t]*:[ \t]*$/im,
  // Outlook: a From:/De : header line followed by Sent/Date/To/Subject.
  /^[ \t]*(?:From|De)[ \t]*:[^\n]*\n[ \t]*(?:Sent|Date|Envoy[ée]|To|[ÀA]|Subject|Objet)[ \t]*:/im,
  /^[ \t]*-{2,}[ \t]*(?:Original Message|Message d'origine|Forwarded message|Message transf[ée]r[ée])[ \t]*-{2,}/im,
  /^[ \t]*_{10,}[ \t]*$/m,
  // The conventional signature delimiter, and the mobile client footers that
  // would otherwise score ("Envoyé de mon iPhone" is two French stopwords).
  /^--[ \t]*$/m,
  /^[ \t]*(?:Sent from my|Envoy[ée] de mon|Get Outlook for|Obtenir Outlook pour)\b/im,
];

/**
 * A sign-off on a line of its own. Everything after it is the signature block:
 * a name, a title, an address and, very often, a legal disclaimer in whichever
 * language head office chose, which says nothing about the language of the
 * message above it. The sign-off line itself is kept, because "Cordialement"
 * IS a signal about the message.
 */
const CLOSER = new RegExp(
  "^[ \\t]*(?:best regards|kind regards|warm regards|regards|best wishes|best|sincerely|yours sincerely|yours faithfully|"
  + "many thanks|thanks|thank you|cheers|cordialement|bien cordialement|tr[eè]s cordialement|bien [àa] vous|"
  + "salutations|sinc[eè]res salutations|meilleures salutations|merci|merci beaucoup|merci d'avance|"
  + "merci par avance|bonne journ[ée]e)[ \\t]*[,.!]*[ \\t]*$",
  "i",
);

/** A salutation line, which is not content for the purpose of the cut above. */
const GREETING = /^[ \t]*(?:hello|hi|hey|dear\b|good (?:morning|afternoon|evening)|bonjour|bonsoir|cher\b|ch[èe]re\b|madame|monsieur)[^\n]{0,40}$/i;

/**
 * The part of a message its sender wrote in it: quoted lines, the first
 * history marker onwards, and anything below a sign-off removed.
 */
function authoredText(value) {
  let text = String(value || "").replace(/\r\n?/g, "\n");
  for (const re of HISTORY_MARKERS) {
    const m = re.exec(text);
    if (m) text = text.slice(0, m.index);
  }
  text = text.split("\n").filter((line) => !/^[ \t]*>/.test(line)).join("\n");

  // Cut at the LAST sign-off, and only one with real content above it. The
  // last, because "Thanks!" can open a reply as easily as close one; real
  // content, because "Hello,\nThanks!\nWe received the documents" must not be
  // cut down to its greeting.
  let cut = null;
  const closers = new RegExp(CLOSER.source, "gim");
  for (let m = closers.exec(text); m; m = closers.exec(text)) {
    const above = text.slice(0, m.index).split("\n").filter((l) => l.trim() && !GREETING.test(l));
    if (above.length) cut = m.index + m[0].length;
  }
  if (cut !== null) text = text.slice(0, cut);
  return text.trim();
}

/* ── Scoring ──────────────────────────────────────────────────────────────── */

/**
 * Function words and mail formulae, by language.
 *
 * Words that are common in BOTH languages are deliberately absent, because
 * they would vote for whichever list they were put in: "a" (French "has",
 * English article), "on", "me", "plus", "son", "an" ("par an"), "per",
 * "date", "service". So are French words that are also ordinary English in
 * this trade: "car" (car carriers) and "mon" (as in "Mon, 3 Nov"). The lists
 * favour words a short business email cannot avoid using.
 */
const FR = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "au", "aux", "et", "est", "sont",
  "nous", "vous", "je", "il", "elle", "ils", "elles", "notre", "votre", "nos", "vos", "leur", "leurs",
  "ma", "mes", "ce", "cette", "ces", "cet", "qui", "que", "quoi", "dont", "où", "ou",
  "pour", "avec", "dans", "sur", "sous", "par", "sans", "chez", "entre", "vers", "depuis", "avant", "après",
  "pas", "ne", "mais", "donc", "si", "aussi", "très", "bien", "déjà", "encore", "toujours",
  "tout", "tous", "toute", "toutes", "être", "avoir", "été", "avons", "avez", "sera", "serait", "fait",
  "peut", "pouvez", "pourriez", "pouvons", "souhaitons", "souhaitez", "merci", "bonjour", "bonsoir",
  "cordialement", "salutations", "veuillez", "ci-joint", "ci-jointe", "ci-dessous", "madame", "monsieur",
  "concernant", "suite", "afin", "lors", "également", "comme", "beaucoup", "retour", "y",
]);

const EN = new Set([
  "the", "and", "is", "are", "was", "were", "be", "been", "being", "we", "you", "your", "our", "ours",
  "they", "their", "them", "it", "its", "this", "that", "these", "those", "i", "my", "us",
  "for", "with", "to", "of", "from", "at", "by", "in", "into", "about", "as", "or", "but", "if",
  "will", "would", "could", "should", "can", "shall", "have", "has", "had", "not", "do", "does", "did",
  "which", "what", "when", "where", "there", "here", "also", "any", "all", "just", "let", "know",
  "please", "kindly", "regards", "thanks", "thank", "attached", "dear", "hello", "hi", "sincerely",
  "find", "below", "above", "received", "following", "regarding", "best",
]);

/** French elision: l'équipe, d'accord, qu'il, n'est, c'est, j'ai, s'il. */
const ELISION = /^(?:l|d|j|m|n|s|t|c|qu|jusqu|lorsqu|puisqu)'[a-zà-ÿœæ]/;
/** English contraction: don't, we're, we'll, I've, I'm, it's, we'd. */
const CONTRACTION = /[a-z](?:n't|'re|'ll|'ve|'m|'s|'d)$/;
/** A letter only French uses among these two languages. */
const FR_LETTER = /[éèêëàâîïôûùüçœ]/;

/** Below this many signal points the text is too short to call. */
const MIN_SIGNAL = 3;
/** The winner must carry at least this multiple of the loser's points. */
const MARGIN = 2;

/**
 * Score a text. Exported for tests and for anyone asking "why French?".
 * @returns {{ fr: number, en: number }}
 */
function score(value) {
  const text = authoredText(value)
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    // URLs and addresses are not prose, and a domain like "transports.fr" or
    // "the-shipping-co.com" would otherwise vote.
    .replace(/\b(?:https?:\/\/|www\.)\S+/g, " ")
    .replace(/\S+@\S+/g, " ");
  const tokens = text.match(/[a-zà-ÿœæ]+(?:['-][a-zà-ÿœæ]+)*/g) || [];
  let fr = 0;
  let en = 0;
  for (const tok of tokens) {
    if (FR.has(tok)) { fr += 1; continue; }
    if (EN.has(tok)) { en += 1; continue; }
    if (ELISION.test(tok)) {
      // The elided article/pronoun is itself the signal; the word after it
      // ("équipe") still gets its accent point below.
      fr += 1;
      if (FR_LETTER.test(tok)) fr += 0.5;
      continue;
    }
    if (CONTRACTION.test(tok)) { en += 1; continue; }
    // Half a point: accents are a strong hint but a single "café" or a
    // client's name ("Hélène") in English prose must not decide the language.
    if (FR_LETTER.test(tok)) fr += 0.5;
  }
  return { fr, en };
}

/**
 * The language a message was written in, or null when it cannot be told with
 * confidence: too little text, or too even a split.
 * @returns {'en'|'fr'|null}
 */
function detectLanguage(value) {
  const { fr, en } = score(value);
  const win = Math.max(fr, en);
  const lose = Math.min(fr, en);
  if (win < MIN_SIGNAL) return null;
  if (win < MARGIN * lose) return null;
  return fr > en ? "fr" : "en";
}

/**
 * The language a thread is being conducted in.
 *
 * The most recent INBOUND message with a confident detection wins: we are
 * answering them, in their language. Only when no inbound message can be read
 * (a thread we opened, or one where they only ever sent "OK") does the most
 * recent message in either direction decide, which keeps a thread in the
 * language we were already writing it in.
 *
 * @param {Array<{direction?: string, body_text?: string}>} msgs oldest first
 * @returns {'en'|'fr'|null}
 */
function conversationLanguage(msgs = []) {
  const list = Array.isArray(msgs) ? msgs : [];
  let anyDirection = null;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i] || {};
    const lang = detectLanguage(m.body_text);
    if (!lang) continue;
    if (m.direction === "IN") return lang;
    if (!anyDirection) anyDirection = lang;
  }
  return anyDirection;
}

/* ── Resolution order for mail assist ─────────────────────────────────────── */

function firstOf(rungs) {
  for (const [source, value] of rungs) {
    const lang = asLang(value);
    if (lang) return { language: lang, source };
  }
  return { language: "en", source: "default" };
}

/**
 * Drafting a reply, composing, dictating:
 *
 *   1. explicit choice in the composer
 *   2. the language the conversation is being conducted in
 *   3. the bound party's preferred_language
 *   4. 'en'
 *
 * @returns {{ language: 'en'|'fr', source: 'explicit'|'conversation'|'party'|'default' }}
 */
function resolveDraftLanguage({ explicit, conversation, party } = {}) {
  return firstOf([["explicit", explicit], ["conversation", conversation], ["party", party]]);
}

/**
 * Rewriting the operator's own text (grammar / shorten / expand): the text
 * keeps its language. An operator who wrote English in a French thread has
 * chosen English, and "Fix grammar" is not the moment to overrule them.
 *
 *   1. explicit choice
 *   2. the language of the text being rewritten
 *   3. the conversation's language
 *   4. the party's preferred_language
 *   5. 'en'
 *
 * @returns {{ language: 'en'|'fr', source: 'explicit'|'text'|'conversation'|'party'|'default' }}
 */
function resolveRewriteLanguage({ explicit, text, conversation, party } = {}) {
  return firstOf([
    ["explicit", explicit], ["text", text], ["conversation", conversation], ["party", party],
  ]);
}

module.exports = {
  detectLanguage, conversationLanguage, authoredText, score,
  resolveDraftLanguage, resolveRewriteLanguage,
  MIN_SIGNAL, MARGIN,
};
