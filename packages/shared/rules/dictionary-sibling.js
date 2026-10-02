"use strict";
/**
 * Dictionary siblings — one service, several fulfilment modes (meeting 6, F2).
 *
 * Seed 9082 gives a service one dictionary row per way it can be delivered,
 * because the way decides the account: "Gate-Pass Fee" paid as our own cost
 * books a class-6 charge, "Gate-Pass Fee — Client Account" advanced for the
 * client books a 4731 débours and is re-billed at cost. Migration 14342 links
 * the rows with `sibling_group`. This file is what both sides need to agree
 * on about them:
 *
 *   - the MODE each direction stands for, and the ONE plain question a picker
 *     asks, in both languages — the API stamps `mode` on every sibling it
 *     returns, the picker draws the answers from the same table;
 *   - which sibling a context PRESETS — a document that bills the client
 *     presets "billed", a purchase on our own account presets "own";
 *   - the MISMATCH rule the line guard shows before a save, with its one
 *     sentence and the sibling a one-tap switch moves to;
 *   - the base label, with the sibling suffix removed, that the group is shown
 *     under once.
 *
 * Named `exports.x =` (not `module.exports = {}`) — see index.js.
 */

/** direction → mode. One mode per direction; a group never holds two of one. */
const MODE_BY_DIRECTION = Object.freeze({
  DISBURSEMENT: "billed",
  EXPENSE: "own",
  ASSET: "deposit",
  REVENUE: "service",
});

/** The order the answers are offered in: the two the meeting was about first. */
const MODE_ORDER = Object.freeze(["billed", "own", "deposit", "service"]);

/** The question and its answers, as the owner worded them (F2). */
const QUESTION = Object.freeze({
  en: "How is this charged on this file?",
  fr: "Comment cette charge est-elle traitée sur ce dossier ?",
});
const ANSWERS = Object.freeze({
  billed: Object.freeze({
    en: "Billed to the client at cost — débours, no VAT",
    fr: "Refacturé au client au prix coûtant — débours, sans TVA",
  }),
  own: Object.freeze({ en: "Our own cost", fr: "Notre propre coût" }),
  deposit: Object.freeze({ en: "A deposit we lodge", fr: "Une caution que nous déposons" }),
  service: Object.freeze({
    en: "Our own service — billed with our margin",
    fr: "Notre propre prestation — facturée avec marge",
  }),
});

/**
 * The suffixes 9082 wrote, in either language, either dash, any case. The same
 * pattern as 14342's backfill.
 *
 * It starts AT the dash, with no leading `\s*`: an unanchored leading
 * whitespace run made every position in a long run of spaces a fresh match
 * attempt that rescanned the run — quadratic on a pasted label (CodeQL
 * js/polynomial-redos). The space before the dash is left to baseLabel's trim.
 */
const SUFFIX = /[—–-]\s*(client account|own cost|deposit|pour compte client|charge propre|d[ée]p[ôo]t)\s*$/i;

function modeOf(direction) {
  return MODE_BY_DIRECTION[String(direction || "").toUpperCase()] || null;
}

/** "Gate-Pass Fee — Client Account" → "Gate-Pass Fee". */
function baseLabel(label) {
  return String(label || "").replace(SUFFIX, "").trim();
}

/** True when a label carries one of the sibling suffixes. */
function hasSiblingSuffix(label) {
  return SUFFIX.test(String(label || ""));
}

const answerFor = (mode, lang) => {
  const a = ANSWERS[mode];
  if (!a) return "";
  return lang === "fr" ? a.fr : a.en;
};

/** Siblings sorted in the order the question offers them. */
function orderSiblings(siblings) {
  return [...(siblings || [])].sort(
    (a, b) => MODE_ORDER.indexOf(modeOf(a.direction)) - MODE_ORDER.indexOf(modeOf(b.direction)),
  );
}

/**
 * The sibling a context presets. `context` is "billed" (the document bills a
 * client — a costing on a client's file, a margin simulation, an invoice) or
 * "own" (a purchase on our own account — PO, supplier invoice, office
 * expense). Falls back through the modes a group may hold: a billed context
 * with no débours row takes our own service; an own context with no own-cost
 * row takes the deposit. Null when nothing fits or there is no context.
 */
function presetFor(context, siblings) {
  const byMode = new Map((siblings || []).map((s) => [modeOf(s.direction), s]));
  const order = context === "billed" ? ["billed", "service"] : context === "own" ? ["own", "deposit"] : [];
  for (const m of order) if (byMode.has(m)) return byMode.get(m);
  return null;
}

/**
 * The guard (F2): a sibling that contradicts its context, flagged before a
 * save with one sentence and the sibling a one-tap switch moves to.
 *
 *   own-cost row on a client-billed document → switch to the débours row
 *   débours row on an internal cost          → switch to the own-cost row
 *
 * Null when the line agrees with its context, when there is no context, or
 * when the group has no row to switch to (the line is then simply what the
 * catalogue says it is).
 */
function mismatch(context, direction, siblings) {
  const mode = modeOf(direction);
  if (context === "billed" && mode === "own") {
    const to = (siblings || []).find((s) => modeOf(s.direction) === "billed");
    if (!to) return null;
    return {
      to,
      to_mode: "billed",
      reason: {
        en: "This is our own cost, so it will not be re-billed to the client and it posts to an expense account. If the client pays for it, bill it at cost.",
        fr: "C'est notre propre coût : il ne sera pas refacturé au client et il est comptabilisé en charge. Si le client le paie, refacturez-le au prix coûtant.",
      },
    };
  }
  if (context === "own" && mode === "billed") {
    const to = (siblings || []).find((s) => modeOf(s.direction) === "own");
    if (!to) return null;
    return {
      to,
      to_mode: "own",
      reason: {
        en: "This is a débours re-billed to the client at cost, but this document is our own purchase. Use our own cost unless the client is paying.",
        fr: "C'est un débours refacturé au client, mais ce document est notre propre achat. Utilisez notre propre coût sauf si le client paie.",
      },
    };
  }
  return null;
}

exports.MODE_BY_DIRECTION = MODE_BY_DIRECTION;
exports.MODE_ORDER = MODE_ORDER;
exports.QUESTION = QUESTION;
exports.ANSWERS = ANSWERS;
exports.SUFFIX = SUFFIX;
exports.modeOf = modeOf;
exports.baseLabel = baseLabel;
exports.hasSiblingSuffix = hasSiblingSuffix;
exports.answerFor = answerFor;
exports.orderSiblings = orderSiblings;
exports.presetFor = presetFor;
exports.mismatch = mismatch;
