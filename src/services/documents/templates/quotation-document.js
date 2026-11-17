/**
 * The quotation, printed as a Full Proposal or a Commercial Extract
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4, §5.7; owner decision D6).
 *
 * ── ONE DOCUMENT, ONE SET OF NUMBERS ───────────────────────────────────────
 *
 * Both outputs are this one function over the same record. `data.output`
 * decides which SECTIONS print (quotation.rules printedKeys): a Full Proposal
 * prints every section that is switched on; a Commercial Extract prints the
 * letterhead cover, Pricing, Terms and Next Steps. The Pricing block is built
 * once, from `data.lines` and `data.totals`, whatever the output, so the
 * switch can never change a number (tests/unit/quotation-document.test.js
 * renders both and compares every figure).
 *
 * ── ONE LANGUAGE PER SHEET ─────────────────────────────────────────────────
 *
 * `cfg.language` is the sheet's one language (template.service
 * resolveDocLanguage). A BILINGUAL quotation is one that is offered in both:
 * the reader switches, and each render is English or French, never a slash on
 * every label. The section words are `body_en` or `body_fr` accordingly; a
 * section written in only one language prints that one rather than nothing.
 *
 * Dates are day-first through `k.dateFmt`; nothing here prints an em dash.
 */
"use strict";

const k = require("./kit");
const { groupLines } = require("./client-headings");
const profileDocument = require("./company-profile-document");
const rules = require("../../../modules/commercial/quotation/quotation.rules");

const has = (v) => v !== undefined && v !== null && String(v).trim() !== "";
const para = (s) => k.esc(s).replace(/\n/g, "<br>");

/** What each output is called (D6: Devis / Proposition commerciale). */
const TITLE = {
  FULL: { en: "Proposal", fr: "Proposition commerciale" },
  EXTRACT: { en: "Quotation", fr: "Devis" },
};

/** Section titles: English chrome in Title Case, French in sentence case. */
const SECTION_TITLE = {
  about_us: { en: "About Us", fr: "À propos de nous" },
  needs: { en: "Your Needs", fr: "Vos besoins" },
  solution: { en: "Our Solution", fr: "Notre solution" },
  scope: { en: "Scope of Services", fr: "Périmètre des prestations" },
  pricing: { en: "Pricing", fr: "Tarification" },
  terms: { en: "Terms", fr: "Conditions" },
  case_stories: { en: "Case Stories", fr: "Références" },
  next_steps: { en: "Next Steps", fr: "Prochaines étapes" },
};

const LINE_COLS = [
  { key: "label", label: { fr: "Désignation", en: "Description" } },
  { key: "amount", label: { fr: "Montant HT", en: "Amount" }, num: true },
  { key: "tax", label: { fr: "TVA", en: "VAT" }, num: true },
];

/** The About Us pages: the parts of the published profile a proposal carries. */
const ABOUT_KEYS = ["who_we_are", "services", "capacity", "certifications", "why_us"];

const lang2 = (cfg) => (cfg.language === "fr" ? "fr" : "en");
const tr = (pair, cfg) => k.t(pair, lang2(cfg));

/** A section's words in the sheet's language, else the other one. */
function words(section, cfg) {
  if (!section) return null;
  const mine = lang2(cfg) === "fr" ? section.body_fr : section.body_en;
  const other = lang2(cfg) === "fr" ? section.body_en : section.body_fr;
  return has(mine) ? mine : has(other) ? other : null;
}

/**
 * The priced lines, grouped by client heading as the printed invoice groups
 * them (14130), with the totals ladder. Exported because the public page and
 * the parity test read the same rows.
 */
function pricing(data, cfg) {
  const ccy = data.currency || cfg.base_currency || "XAF";
  const display = (data.lines || []).map((l) => (l && l.tax_rate !== undefined ? { ...l, tax: l.tax_rate } : l));
  const grouped = groupLines(display, lang2(cfg), data.client_headings, data.family_order);
  const rows = grouped.map((g) => ({
    label: g.label,
    amount: k.money(g.amount, ccy, cfg),
    tax: has(g.tax) ? `${String(g.tax).replace(".", lang2(cfg) === "fr" ? "," : ".")}%` : "",
  }));
  const t = data.totals || {};
  const totals = [
    [{ fr: "Total HT", en: "Subtotal" }, k.money(t.service_ht, ccy, cfg)],
    [{ fr: "TVA", en: "VAT" }, k.money(t.vat_total, ccy, cfg)],
    [{ fr: "Total TTC", en: "Total" }, k.money(t.total_ttc, ccy, cfg), { grand: true }],
  ];
  return { rows, totals, ccy };
}

function termsHtml(data, cfg, section) {
  const lines = [];
  if (data.valid_until) {
    lines.push(`${tr({ en: "Valid until", fr: "Valable jusqu'au" }, cfg)}: ${k.esc(k.dateFmt(data.valid_until))}`);
  }
  if (data.payment_terms_days !== null && data.payment_terms_days !== undefined) {
    const n = Number(data.payment_terms_days);
    lines.push(n === 0
      ? tr({ en: "Payment: on receipt of invoice", fr: "Paiement : à réception de facture" }, cfg)
      : `${tr({ en: "Payment", fr: "Paiement" }, cfg)}${lang2(cfg) === "fr" ? " : " : ": "}${n} ${tr({ en: "days from invoice", fr: "jours à compter de la facture" }, cfg)}`);
  }
  const body = words(section, cfg);
  return [
    lines.length ? `<p class="q-p">${lines.join("<br>")}</p>` : "",
    body ? `<p class="q-p">${para(body)}</p>` : "",
  ].join("");
}

function storiesHtml(data, cfg, section) {
  const ids = (section && section.story_ids) || [];
  const stories = (data.stories || []).filter((s) => !ids.length || ids.includes(s.id));
  const intro = words(section, cfg);
  return [
    intro ? `<p class="q-p">${para(intro)}</p>` : "",
    stories.map((s) => `<div class="q-story"><strong>${k.esc(s.title)}</strong>${has(s.client) ? ` <span class="muted">${k.esc(s.client)}</span>` : ""}${
      has(s.summary) ? `<div>${para(s.summary)}</div>` : ""}</div>`).join(""),
  ].join("");
}

function nextStepsHtml(data, cfg) {
  const how = data.share_open
    ? tr({ en: "Accept or decline this proposal from the link you received, where you can also download it. Acceptance is signed online.", fr: "Acceptez ou déclinez cette offre depuis le lien reçu, où vous pouvez aussi la télécharger. L'acceptation se signe en ligne." }, cfg)
    : tr({ en: "To accept this offer, sign and return it, or reply to the email it came with.", fr: "Pour accepter cette offre, signez-la et retournez-la, ou répondez au courriel qui l'accompagne." }, cfg);
  const c = data.contact || {};
  const who = [c.name, c.email, c.phone].filter(has).map(k.esc).join(" · ");
  return `<p class="q-p">${how}</p>${who ? `<p class="q-p">${tr({ en: "Your contact", fr: "Votre contact" }, cfg)}${lang2(cfg) === "fr" ? " : " : ": "}${who}</p>` : ""}`;
}

function aboutHtml(data, cfg) {
  const p = data.about_us && data.about_us[lang2(cfg) === "fr" ? "FR" : "EN"];
  if (!p || !Array.isArray(p.sections)) return "";
  return p.sections
    .filter((s) => ABOUT_KEYS.includes(s.key) && profileDocument.RENDER[s.key])
    .map((s) => `<div class="q-h">${k.esc(s.title)}</div>${profileDocument.RENDER[s.key](s)}`)
    .join("");
}

const STYLE = (cfg) => `<style>
  .q-cover { padding: 14px 0 6px; }
  .q-cover h1 { font-size: 24px; line-height: 1.2; margin: 0 0 4px; }
  .q-p { margin: 0 0 8px; }
  .q-h { font-weight: 600; margin: 10px 0 4px; }
  .q-story { padding: 6px 0; border-bottom: 1px solid ${cfg.line || "#E4ECF6"}; break-inside: avoid; }
  .q-pricing { break-inside: avoid; }
</style>`;

/**
 * Build the sheet. `data` is template.service loadRecord's QUOTATION record:
 * the signed fields (number, date, valid_until, party, lines, totals) plus the
 * document's own (output, title, sections, about_us, stories, contact).
 */
function build(data, cfg, entity, verify) {
  const d = data || {};
  const output = d.output === "EXTRACT" ? "EXTRACT" : "FULL";
  const sectionRows = Array.isArray(d.sections) ? d.sections : [];
  const byKey = new Map(sectionRows.map((s) => [s.section_key, s]));
  const keys = rules.printedKeys(output, sectionRows);
  const { rows, totals } = pricing(d, cfg);
  const meta = [
    [{ fr: "Date", en: "Date" }, k.dateFmt(d.date)],
    [{ fr: "Valable jusqu'au", en: "Valid until" }, k.dateFmt(d.valid_until)],
    d.version && Number(d.version) > 1 ? [{ fr: "Version", en: "Version" }, String(d.version)] : null,
  ].filter(Boolean);

  const parts = [STYLE(cfg), k.standardHead(entity, cfg, { title: TITLE[output], number: d.number, meta })];
  for (const key of keys) {
    const section = byKey.get(key);
    if (key === "cover") {
      parts.push(
        output === "FULL" && has(d.title) ? `<div class="q-cover"><h1 class="accent">${k.esc(d.title)}</h1></div>` : "",
        k.parties([
          { label: { fr: "Émetteur", en: "From" }, name: entity.legal_name, lines: [entity.address, entity.niu && `NIU ${entity.niu}`] },
          { label: { fr: "À l'attention de", en: "Prepared for" }, name: d.party && d.party.name, lines: (d.party && d.party.lines) || [] },
        ], cfg),
      );
    } else if (key === "pricing") {
      parts.push(k.section(SECTION_TITLE.pricing, `<div class="q-pricing">${k.lineTable(LINE_COLS, rows, cfg)}${k.totals(totals, cfg)}</div>`, cfg));
    } else if (key === "terms") {
      const html = termsHtml(d, cfg, section);
      if (html) parts.push(k.section(SECTION_TITLE.terms, html, cfg));
    } else if (key === "about_us") {
      const html = aboutHtml(d, cfg);
      if (html) parts.push(k.section(SECTION_TITLE.about_us, html, cfg));
    } else if (key === "case_stories") {
      const html = storiesHtml(d, cfg, section);
      if (html) parts.push(k.section(SECTION_TITLE.case_stories, html, cfg));
    } else if (key === "next_steps") {
      parts.push(k.section(SECTION_TITLE.next_steps, nextStepsHtml(d, cfg), cfg));
    } else {
      const body = words(section, cfg);
      if (body) parts.push(k.section(SECTION_TITLE[key], `<p class="q-p">${para(body)}</p>`, cfg));
    }
  }
  // A quotation accepted by signature carries the client's seal, and the seal
  // carries the QR (one per page, §3.12a), so the footer then prints none.
  const seals = Array.isArray(d.seals) ? d.seals : [];
  parts.push(
    seals.length ? seals.map((sig) => k.sealBlock(sig, cfg, { titled: true })).join("") : k.signatureBlock(cfg),
    k.standardFoot(entity, cfg, seals.length ? null : verify),
  );
  return k.shell(`${tr(TITLE[output], cfg)} ${d.number || ""}`.trim(), parts.join(""), cfg);
}

const sampleParty = { name: "CIMENCAM SA", lines: ["Douala, Cameroun", "NIU P012345678"] };
const sampleData = {
  number: "DEV-2026-0042", date: "2026-07-27", valid_until: "2026-08-27", currency: "XAF", output: "FULL",
  title: "Sea freight and clearance, Douala to N'Djamena", party: sampleParty, payment_terms_days: 30,
  lines: [
    { label: "Sea freight, 40ft container", qty: 2, unit: 450000, tax: 19.25, amount: 900000, client_heading_code: "FREIGHT_CARRIER", client_heading_en: "Freight & Carrier Charges", client_heading_fr: "Fret et Frais du Transporteur", client_heading_sort: 30 },
    { label: "Customs disbursement", qty: 1, unit: 320000, tax: 0, tax_rate: null, amount: 320000, is_disbursement: true, client_heading_code: "CUSTOMS_FORMALITIES", client_heading_en: "Customs Formalities", client_heading_fr: "Formalités Douanières", client_heading_sort: 10 },
  ],
  totals: { service_ht: 1220000, vat_total: 173250, total_ttc: 1393250 },
  sections: [
    { section_key: "needs", enabled: true, body_en: "Two containers a month from Asia to N'Djamena, cleared in Douala.", body_fr: "Deux conteneurs par mois d'Asie vers N'Djamena, dédouanés à Douala." },
    { section_key: "solution", enabled: true, body_en: "One team from the port to the warehouse.", body_fr: "Une seule équipe du port à l'entrepôt." },
  ],
  contact: { name: "Sales Desk", email: "sales@example.com", phone: null },
};

module.exports = { build, pricing, sampleData, TITLE, SECTION_TITLE };
