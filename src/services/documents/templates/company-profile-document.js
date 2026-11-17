/**
 * The Company Profile PDF (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.6, §5.7).
 *
 * ── IT PRINTS THE PRESENTATION, NOTHING ELSE ───────────────────────────────
 *
 * `data` is `company_profile.presentation.build()`'s output: the same object
 * the public page and the staff preview read. Hidden items were removed before
 * it was built, every word is already in the document's one language, and
 * every figure is already formatted. This file decides where things sit on the
 * page and never which things there are, so the PDF cannot show something the
 * page does not.
 *
 * ── BRANDED THROUGH THE RENDERER ───────────────────────────────────────────
 *
 * The letterhead, the logo and the accent come from `cfg`, resolved by the
 * document renderer from the entity's letterhead and the tenant's branding
 * (company_profile.service `documentHtml`). Nothing here names a colour.
 */
"use strict";

const k = require("./kit");

const has = (v) => v !== undefined && v !== null && v !== "";
const para = (s) => k.esc(s).replace(/\n/g, "<br>");
const pair = (s) => ({ fr: s, en: s });

const STYLE = (cfg) => `<style>
  .cp-cover { padding: 18px 0 10px; }
  .cp-hero { width: 100%; max-height: 82mm; object-fit: cover; border-radius: 6px; display: block; margin-bottom: 14px; }
  .cp-name { font-size: 26px; line-height: 1.15; margin: 0; }
  .cp-tag { font-size: 14px; margin: 6px 0 0; }
  .cp-meta { margin-top: 6px; font-size: 10.5px; }
  .cp-p { margin: 0 0 8px; }
  .cp-h { font-weight: 600; margin: 10px 0 2px; }
  .cp-list { margin: 0; padding: 0; list-style: none; }
  .cp-list li { padding: 5px 0; border-bottom: 1px solid ${cfg.line || "#E4ECF6"}; break-inside: avoid; }
  .cp-list li:last-child { border-bottom: 0; }
  .cp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .cp-grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 16px; }
  .cp-fig { border: 1px solid ${cfg.line || "#E4ECF6"}; border-radius: 6px; padding: 8px 10px; break-inside: avoid; }
  .cp-fig .v { font-size: 17px; font-weight: 700; }
  .cp-fig .l { font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; }
  .cp-story { padding: 8px 0; border-bottom: 1px solid ${cfg.line || "#E4ECF6"}; break-inside: avoid; }
  .cp-kpis { margin-top: 4px; font-size: 10.5px; }
  .cp-logos { display: flex; flex-wrap: wrap; gap: 14px 22px; align-items: center; }
  .cp-logos img { max-height: 14mm; max-width: 34mm; object-fit: contain; }
  .cp-contact td { padding: 2px 12px 2px 0; vertical-align: top; }
</style>`;

const RENDER = {
  who_we_are: (s) => s.paragraphs.map((p) =>
    `${p.label ? `<div class="cp-h">${k.esc(p.label)}</div>` : ""}<p class="cp-p">${para(p.body)}</p>`).join(""),

  services: (s) => `<ul class="cp-list">${s.items.map((i) =>
    `<li><strong>${k.esc(i.name)}</strong>${has(i.sentence) ? `<div class="muted">${para(i.sentence)}</div>` : ""}</li>`).join("")}</ul>`,

  capacity: (s) => [
    s.figures.length ? `<div class="cp-grid">${s.figures.map((f) =>
      `<div class="cp-fig"><div class="l muted">${k.esc(f.label)}</div><div class="v accent">${k.esc(f.value)}</div>${
        has(f.detail) ? `<div class="muted">${k.esc(f.detail)}</div>` : ""}</div>`).join("")}</div>` : "",
    has(s.note) ? `<p class="cp-p" style="margin-top:10px">${para(s.note)}</p>` : "",
  ].join(""),

  certifications: (s) => `<ul class="cp-list">${s.items.map((i) =>
    `<li><strong>${k.esc(i.name)}</strong> <span class="muted">${k.esc(i.kind)}</span></li>`).join("")}</ul>`,

  case_stories: (s) => s.items.map((i) => `<div class="cp-story">
    <strong>${k.esc(i.title)}</strong> <span class="muted">${k.esc(i.client)}</span>
    ${has(i.summary) ? `<div>${para(i.summary)}</div>` : ""}
    ${i.kpis && i.kpis.length ? `<div class="cp-kpis">${i.kpis.map((x) =>
      `<span class="accent"><strong>${k.esc(x.value)}</strong></span> <span class="muted">${k.esc(x.label)}</span>`).join(" &nbsp; ")}</div>` : ""}
  </div>`).join(""),

  clients: (s) => `<div class="cp-logos">${s.logos.map((l) =>
    `<img src="${k.esc(l.url)}" alt="${k.esc(l.name)}">`).join("")}</div>`,

  why_us: (s) => `<div class="cp-grid2">${s.items.map((i) =>
    `<div>${has(i.title) ? `<div class="cp-h accent">${k.esc(i.title)}</div>` : ""}${has(i.body) ? `<div>${para(i.body)}</div>` : ""}</div>`).join("")}</div>`,

  contact: (s) => `<table class="cp-contact">${s.lines.map((l) =>
    `<tr><td class="muted">${k.esc(l.label)}</td><td>${k.esc(l.value)}</td></tr>`).join("")}</table>`,
};

function build(data, cfg, entity) {
  const d = data || {};
  const company = d.company || {};
  const version = d.version || null;
  const meta = [
    d.title,
    version && version.number ? `v${version.number}` : null,
    version && version.published_at ? k.dateFmt(version.published_at) : null,
  ].filter(has).map(k.esc).join(" · ");
  const sections = (d.sections || [])
    .filter((s) => RENDER[s.key])
    .map((s) => k.section(pair(s.title), RENDER[s.key](s), cfg))
    .join("");
  const body = [
    STYLE(cfg),
    k.standardHead(entity, cfg, {}),
    `<div class="cp-cover">
      ${has(company.cover_url) ? `<img class="cp-hero" src="${k.esc(company.cover_url)}" alt="">` : ""}
      <h1 class="cp-name">${k.esc(company.name || entity.legal_name || "")}</h1>
      ${has(company.tagline) ? `<p class="cp-tag accent">${k.esc(company.tagline)}</p>` : ""}
      <div class="cp-meta muted">${meta}</div>
    </div>`,
    sections,
    k.standardFoot(entity, cfg, null),
  ].join("");
  return k.shell(`${d.title || "Company Profile"} ${company.name || ""}`.trim(), body, cfg);
}

/** What the Document Studio previews when a tenant has no profile published. */
const sampleData = {
  language: "EN",
  title: "Company Profile",
  version: { number: 3, published_at: "2026-11-02" },
  company: { name: "Smart Logistics", tagline: "Freight through Central Africa, door to door", cover_url: null, logo_url: null },
  sections: [
    { key: "who_we_are", title: "Who We Are", paragraphs: [
      { key: "positioning", label: null, body: "A freight forwarder and customs broker based in Douala, moving cargo between the port and the CEMAC hinterland." },
      { key: "mission", label: "Our Mission", body: "Every shipment cleared on time, every client told before they ask." },
    ] },
    { key: "services", title: "Services", items: [
      { name: "Sea Freight", sentence: "Full and groupage containers through Douala and Kribi." },
      { name: "Customs Clearance", sentence: "In-house brokers at the port and at the land borders." },
    ] },
    { key: "capacity", title: "Capacity & Network", figures: [
      { key: "fleet_size", label: "Fleet Size", value: "24", detail: "vehicles" },
      { key: "offices", label: "Offices", value: "3", detail: "Douala, Yaoundé, Garoua" },
      { key: "regions", label: "Countries Served", value: "Cameroon, Chad, Central African Republic", detail: null },
    ], note: null },
    { key: "certifications", title: "Certifications & Memberships", items: [
      { name: "ISO 9001", kind: "Certification" }, { name: "WCA", kind: "Membership" },
    ] },
    { key: "why_us", title: "Why Choose Us", items: [
      { title: "One contact", body: "One account manager from quote to delivery." },
      { title: "Own fleet", body: "Our trucks, our drivers, our tracking." },
    ] },
    { key: "contact", title: "Contact", lines: [
      { key: "phone", label: "Phone", value: "+237 233 00 00 00", href: null },
      { key: "email", label: "Email", value: "contact@example.com", href: null },
    ] },
  ],
};

module.exports = { build, sampleData };
