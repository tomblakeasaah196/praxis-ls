/**
 * What the quotation's ONE render reads beside its signed fields
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4 "One HTML render is the preview,
 * the public page and the PDF", §5.7).
 *
 * template.service `loadRecord("QUOTATION")` reads the signed fields (number,
 * date, validity, party, lines, totals: the ones canonical.js hashes) and asks
 * this for the rest: the output, the title, the sections, the About Us pages,
 * the case stories and the contact. None of it is hashed, so a quotation
 * signed before the revamp still reads VALID.
 *
 * Every renderer goes through `render` below or through template.service with
 * the same `variant`, so the staff preview, the public page and the PDF are
 * one function's output over one record.
 */
"use strict";

const repo = require("./quotation.repo");
const rules = require("./quotation.rules");
const quotationSections = require("./quotation.sections");

const has = (v) => v !== undefined && v !== null && String(v).trim() !== "";

/** The published Company Profile pinned on the quotation (else today's), in each language it is offered in. */
async function aboutUs(client, q, languages) {
  const profile = require("../../sales/company_profile/company_profile.service");
  const { rows } = q.profile_version_id
    ? await client.query("SELECT * FROM company_profile_version WHERE version_id = $1", [q.profile_version_id])
    : await client.query("SELECT * FROM company_profile_version WHERE status = 'PUBLISHED' ORDER BY number DESC LIMIT 1");
  const version = rows[0];
  if (!version) return null;
  const out = {};
  for (const lang of languages) out[lang] = await profile.present(client, version, lang);
  return out;
}

/** Published stories only, and a client named only with its consent (the profile's own read). */
async function stories(client, ids) {
  if (!ids.length) return [];
  const profileRepo = require("../../sales/company_profile/company_profile.repo");
  const rows = await profileRepo.publishedStories(client, ids);
  return rows.map((s) => ({
    id: s.success_story_id,
    title: s.title,
    summary: s.executive_summary || s.headline || null,
    client: s.client_name || null,
  }));
}

/** Who the client talks to: the request's owner, else the company row's, else whoever sent it. */
async function contact(client, q) {
  const { rows } = await client.query(
    `SELECT u.full_name, u.email, u.whatsapp_number
       FROM app_user u
      WHERE u.user_id = COALESCE(
              (SELECT owner_user_id FROM quote_request WHERE quote_request_id = $1),
              (SELECT owner_user_id FROM lead WHERE lead_id = $2),
              $3::uuid)
      LIMIT 1`,
    [q.quote_request_id || null, q.lead_id || null, q.sent_by || null],
  );
  const u = rows[0];
  return u ? { name: u.full_name || null, email: u.email || null, phone: u.whatsapp_number || null } : null;
}

/**
 * The document fields of one quotation. `variant.output` overrides the
 * quotation's own switch for this render only (the editor previews both, the
 * reader on the link sees the one chosen at send).
 */
async function extras(client, q, variant = {}) {
  const output = variant.output === "EXTRACT" || variant.output === "FULL" ? variant.output : q.default_output || "FULL";
  const sections = await quotationSections.read(client, q.quotation_id);
  const printed = rules.printedKeys(output, sections);
  const storyRow = sections.find((s) => s.section_key === "case_stories");
  const [about, storyList, who, terms] = await Promise.all([
    printed.includes("about_us") ? aboutUs(client, q, rules.languagesOf(q)) : null,
    printed.includes("case_stories") && storyRow ? stories(client, storyRow.story_ids || []) : [],
    contact(client, q),
    q.client_id
      ? client.query("SELECT payment_terms_days FROM client_master WHERE client_id = $1", [q.client_id])
      : q.lead_id ? client.query("SELECT payment_terms_days FROM lead WHERE lead_id = $1", [q.lead_id]) : { rows: [] },
  ]);
  const days = terms.rows[0] ? terms.rows[0].payment_terms_days : null;
  return {
    output,
    title: q.title || null,
    record_language: q.language || null,
    version: q.version || 1,
    sections,
    about_us: about,
    stories: storyList,
    contact: who,
    payment_terms_days: days === null || days === undefined ? null : Number(days),
    share_open: rules.linkState(q) === "OPEN",
  };
}

/** The party a prospect's quotation is addressed to: its company row. */
async function prospectParty(client, leadId) {
  const lead = await repo.leadHead(client, leadId);
  if (!lead) return null;
  return { name: lead.company_name || lead.contact_name || "", lines: [lead.contact_name, lead.email].filter(has) };
}

/**
 * The one render, as HTML: the staff preview and the public page. The PDF is
 * template.service `generate` with the same variant, which builds the same
 * HTML and vaults it.
 */
async function render(client, { id, output = null, language = "EN", origin = null, env = "live" }) {
  const template = require("../../documents/template/template.service");
  const q = await repo.get(client, id);
  const lang = rules.pickLanguage(q, language);
  const out = await template.preview(client, {
    docType: "QUOTATION", recordId: id, origin, env, language: lang.toLowerCase(), variant: { output },
  });
  return { html: out.html, data: out.data, language: lang };
}

/** The PDF of one output in one language, vaulted like every generated document. */
async function pdf(client, { id, output = null, language = "EN", origin = null, env = "live", actor = {} }) {
  const template = require("../../documents/template/template.service");
  const vault = require("../../vault/document_vault/document_vault.service");
  const q = await repo.get(client, id);
  const lang = rules.pickLanguage(q, language);
  const made = await template.generate(client, {
    docType: "QUOTATION", recordId: id, actor, origin, env, language: lang.toLowerCase(), variant: { output },
  });
  const bytes = await vault.fetchBytes(client, made.doc_id);
  const kind = (output || q.default_output) === "EXTRACT" ? "quotation" : "proposal";
  return { buffer: bytes.buffer, name: `${q.doc_number || kind}-${lang.toLowerCase()}.pdf`, doc_id: made.doc_id, language: lang };
}

module.exports = { extras, prospectParty, render, pdf, aboutUs, stories, contact };
