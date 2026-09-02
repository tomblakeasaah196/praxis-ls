/**
 * The one thing a model is allowed to do to a contract.
 *
 * ── WHAT THIS USED TO BE ───────────────────────────────────────────────────
 *
 * Thirteen facts and "draft the body of this document". The model wrote every
 * clause, so two hires on identical terms got different contracts, the wording
 * could not be diffed between two employees or two months, a vendor outage
 * meant a template fallback that was a different document again, and the whole
 * thing was written in English against Cameroonian labour law.
 *
 * The eighteen clause libraries are the document now. What is left for a model
 * is the single thing it is genuinely better at than a template: saying what
 * THIS person will actually do, in the duties clause, in prose that reads like
 * it was written for the job rather than for a form.
 *
 * ── THE LEASH IS STRUCTURAL, NOT A PROMPT ──────────────────────────────────
 *
 * The model is given the AUTHORED clause — tokens and all, `{{term.job_title}}`
 * unresolved — and asked to rephrase it. It never sees a salary, a date, a
 * national identity number or a parent's name, because the clause it is
 * rewriting contains none of them. What comes back is then checked against the
 * original before it is accepted:
 *
 *   · every token in the authored text is still present, exactly once, and no
 *     token has been invented — so the FACTS are still filled by the composer,
 *     from the record, after the model has finished;
 *   · every number in the authored text survives — a model that turned "six
 *     (06) months" into "6 months" has changed a legal figure's form, and one
 *     that turned it into twelve has changed the agreement;
 *   · the result is prose of a plausible length, with no headings, no markdown
 *     furniture and no new clause bolted on the end.
 *
 * A rewrite that fails any of those is DISCARDED and the authored clause stands.
 * There is no partial acceptance and no repair pass: the authored text is a
 * good clause, so the cost of refusing a rewrite is nil and the cost of
 * accepting a bad one is a defective contract.
 *
 * ── IT NEVER THROWS ────────────────────────────────────────────────────────
 *
 * A tenant with no AI vendor configured gets the authored clause, which is the
 * clause counsel reviewed. Refinement is a finish, never a dependency.
 */
"use strict";

const llm = require("../../../services/ai/llm.service");
const { logger } = require("../../../config/logger");
const { tokensIn } = require("../../../services/contracts/clause-tokens");
const libraries = require("../../../services/contracts/libraries");

/** A rewrite may not shrink a clause to a sentence or double its length. */
const MIN_RATIO = 0.6;
const MAX_RATIO = 2.0;

/** Every digit run in the text — "six (06) months" carries 06. */
const numbersIn = (text) => (String(text || "").match(/\d+/g) || []).sort();

/** Same multiset of tokens, each still used exactly as often. */
function sameTokens(before, after) {
  const a = tokensIn(before).sort();
  const b = tokensIn(after).sort();
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/**
 * Accept the rewrite, or say why not.
 *
 * Returns null when it is fine, otherwise the reason — logged, so a tenant
 * whose model keeps failing one check can be told which, rather than being left
 * to wonder why refinement silently does nothing.
 */
function rejectionReason(authored, rewritten) {
  if (!rewritten) return "empty";
  if (/^#{1,6}\s|\n#{1,6}\s/.test(rewritten)) return "heading";
  if (/```/.test(rewritten)) return "code fence";
  if (!sameTokens(authored, rewritten)) return "tokens changed";
  const a = numbersIn(authored);
  const b = numbersIn(rewritten);
  if (a.length !== b.length || a.some((n, i) => n !== b[i])) return "figures changed";
  const ratio = rewritten.length / Math.max(authored.length, 1);
  if (ratio < MIN_RATIO) return `too short (${ratio.toFixed(2)}×)`;
  if (ratio > MAX_RATIO) return `too long (${ratio.toFixed(2)}×)`;
  return null;
}

/** Strip the furniture a model adds however firmly it is asked not to. */
function tidy(text) {
  if (!text) return null;
  let out = String(text).trim();
  const fence = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i.exec(out);
  if (fence) out = fence[1].trim();
  // A restated heading above the clause — the composer prints the heading.
  out = out.replace(/^#{1,6}\s+.*\n+/, "");
  // "Here is the rewritten clause:" and friends.
  out = out.replace(/^(?:here(?:'s| is)|voici)\b[^\n]*:\s*\n+/i, "");
  return out.trim() || null;
}

function promptMessages({ clause, language, jobTitle, department, sopTitles }) {
  const lang = language === "en" ? "English" : "French";
  const about = [
    jobTitle ? `Job title: ${jobTitle}` : null,
    department ? `Department: ${department}` : null,
    sopTitles && sopTitles.length ? `Company policies this employee is bound by: ${sopTitles.join("; ")}` : null,
  ].filter(Boolean).join("\n");

  return [
    {
      role: "system",
      content: [
        `You edit one clause of an employment contract governed by the Cameroon Labour Code. You write in ${lang} and you return ${lang} only.`,
        "",
        "You are given a clause and some context about the job. Rewrite the clause so it describes THIS role concretely instead of generically. Keep it to the duties and the standard of performance expected.",
        "",
        "ABSOLUTE RULES:",
        `1. Placeholders of the form {{something.something}} are filled in later from the employer's records. Reproduce every one of them EXACTLY as written, the same number of times. Do not add new ones, do not remove one, do not translate what is inside the braces.`,
        "2. Reproduce every number and figure exactly as it is written, including the bracketed form — « six (06) mois » stays « six (06) mois ».",
        "3. Do not add an obligation, a benefit, a restriction or a duration that is not already in the clause. You are rewriting one clause, not negotiating it.",
        "4. Return the clause text and nothing else. No heading, no title, no numbering, no preamble, no commentary, no markdown fences. Paragraphs separated by a blank line.",
        "5. Stay close to the original length — between about the same and half as long again.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `${about ? `${about}\n\n` : ""}Rewrite this clause:\n\n${clause}`,
    },
  ];
}

/**
 * Rephrase the clauses a library marks `aiEditable`, for one contract.
 *
 * Call OUTSIDE a transaction: it is a model call of several seconds against a
 * 12-connection-per-tenant ceiling. `client` is passed only so `llm.chat` can
 * resolve the tenant's configured vendor.
 *
 * @returns {Promise<{overrides: object, ai_generated: boolean, ai_model: string|null, rejected: object[]}>}
 *          `overrides` is keyed by article key — exactly the shape
 *          `hr_contract.compose.build` takes as `clauseOverrides`.
 */
async function refine(client, { libraryKey, language, jobTitle, department, sopTitles = [] } = {}) {
  const overrides = {};
  const rejected = [];
  let model = null;

  let library;
  try {
    library = libraries.get(libraryKey, language);
  } catch (err) {
    logger.warn({ err, libraryKey, language }, "[hr_contract] no library to refine");
    return { overrides, ai_generated: false, ai_model: null, rejected };
  }

  const editable = library.articles.filter((a) => a.aiEditable);
  for (const article of editable) {
    try {
      const { text, provider } = await llm.chat({
        client,
        messages: promptMessages({ clause: article.body, language, jobTitle, department, sopTitles }),
        temperature: 0.3, // A contract is not a place for invention.
      });
      const candidate = tidy(text);
      const reason = rejectionReason(article.body, candidate);
      if (reason) {
        // Named, not silent. A vendor that keeps failing one check is a fact
        // somebody can act on; "the AI did nothing again" is not.
        logger.warn({ article: article.key, reason, provider }, "[hr_contract] clause rewrite rejected — keeping the authored clause");
        rejected.push({ article: article.key, reason });
        continue;
      }
      overrides[article.key] = candidate;
      model = provider || "ai";
    } catch (err) {
      logger.warn({ err, article: article.key }, "[hr_contract] clause refinement failed — keeping the authored clause");
      rejected.push({ article: article.key, reason: "provider error" });
    }
  }

  return {
    overrides,
    ai_generated: Object.keys(overrides).length > 0,
    ai_model: model,
    rejected,
  };
}

module.exports = { refine, rejectionReason, tidy, sameTokens, numbersIn, promptMessages, MIN_RATIO, MAX_RATIO };
