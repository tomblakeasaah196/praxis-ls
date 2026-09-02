#!/usr/bin/env node
/**
 * How many A4 pages does a composed contract actually take?
 *
 * A contract that runs to seven pages is a different document from one that
 * runs to three — it is harder to read, more expensive to print in duplicate,
 * and a signature panel orphaned on a page of its own looks like an
 * afterthought. The budget for these libraries is three to four pages, and the
 * only way to know is to render one.
 *
 * NOT a CI gate: it needs Chromium and about ten seconds, and the number moves
 * legitimately whenever a clause is added. Run it after editing a library, and
 * update the table in doc/CONTRACT_LIBRARIES.md.
 *
 *   node scripts/dev/measure-contract-pages.js
 *
 * Same launch options and the same `page.pdf({ format: "A4" })` as
 * services/pdf.service, so the number is the one a tenant would get.
 * Exits 1 if anything exceeds four pages.
 */
const puppeteer = require("/home/user/praxis-ls/node_modules/puppeteer");
const composer = require("/home/user/praxis-ls/src/modules/hr/hr_contract/hr_contract.compose");
const { contractArticles } = require("/home/user/praxis-ls/src/modules/documents/template/template.service");
const registry = require("/home/user/praxis-ls/src/services/documents/templates/registry");
const kit = require("/home/user/praxis-ls/src/services/documents/templates/kit");

const EMP = {
  employee_id: "e1", full_name: "FORGHAB Marie-Claire", maiden_name: "FORMUM", civility: "MRS", gender: "FEMALE",
  date_of_birth: "1990-02-28", place_of_birth: "Bamenda", father_name: "FORMUM Peter", mother_name: "NGWA Elizabeth",
  nationality: "CM", id_document_type: "CNI", id_document_number: "119874563",
  id_document_issued_on: "2021-06-01", id_document_issued_at: "Douala",
  residence_address: "Rue 1.234, Akwa", residence_city: "Douala", staff_no: "SLAS-014",
  job_title: "Déclarant en douane", department: "Opérations", base_salary: 600000, salary_currency: "XAF",
  probation_months: 3, place_of_work: "Douala", working_hours: "08h00–17h00, du lundi au vendredi",
  payment_method: "BANK_TRANSFER",
};
const ENT = {
  entity_id: "en1", legal_name: "SLAS LOGISTICS SARL", legal_form: "SARL",
  address: "Boulevard de la Liberté, Akwa", po_box: "BP 4521", city: "Douala", country_code: "CM",
  phone: "+237 233 42 11 90", email: "rh@slas.cm", default_language: "fr",
};
const REP = { person_id: "p1", full_name: "Marc-Aurèle Ngassa", title: "Gérant", role: "LEGAL_REPRESENTATIVE" };
const ALLOW = [
  { label: "Prime de responsabilité", amount: 50000, kind: "ALLOWANCE", in_gross: true },
  { label: "Véhicule de fonction", amount: 80000, kind: "BENEFIT_IN_KIND", in_gross: false },
];

const row = (type, lang, extra = {}) => ({
  hr_contract_id: "c1", kind: extra.kind || "EMPLOYMENT", status: "DRAFT",
  effective_on: "2026-10-01", end_on: extra.end_on || null, doc_number: "CTR-2026-0014",
  language: lang, employment_type: type,
  employee: { ...EMP, employment_type: type }, entity: ENT, representative: REP, allowances: ALLOW,
  ...extra,
});

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/opt/pw-browsers/chromium",
    headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const cases = [
    ["CDI", "fr", {}], ["CDI", "en", {}],
    ["CDD", "fr", { end_on: "2027-09-30" }], ["CDD", "en", { end_on: "2027-09-30" }],
    ["STAGE", "fr", { end_on: "2027-03-31" }],
    ["CONSULTANT", "fr", { end_on: "2027-09-30" }],
    ["INTERIM", "fr", { end_on: "2027-03-31" }],
    ["TEMPORARY", "fr", { end_on: "2027-03-31" }],
    ["CDI", "fr", { kind: "OFFER_LETTER", end_on: "2026-09-20" }],
    ["CDI", "fr", { kind: "TERMINATION" }],
  ];
  console.log("library      lang  articles  pages");
  let worst = 0;
  for (const [type, lang, extra] of cases) {
    const r = row(type, lang, extra);
    if (extra.kind === "TERMINATION" || extra.kind === "OFFER_LETTER") r.notice_days = 30;
    if (extra.kind === "OFFER_LETTER") r.probation_months = 3;
    let built;
    try { built = composer.build(r, { overrides: { notice_days: 30, probation_ends_on: "2027-01-01" } }); }
    catch (e) { console.log(`${(extra.kind || type).padEnd(13)}${lang}    REFUSED ${JSON.stringify(e.details && e.details.missing)}`); continue; }
    const c = built.columns;
    const data = {
      number: "CTR-2026-0014", kind: r.kind, effective_on: c.effective_on, end_on: c.end_on,
      employee_name: c.employee_snapshot.full_name, staff_no: c.employee_snapshot.staff_no,
      job_title: c.job_title, doc_title: c.title, library: c.clause_library_key,
      representative: { name: REP.full_name, title: REP.title },
      articles: contractArticles(built.body_md), closing: c.closing_md,
      signature_labels: JSON.parse(c.signature_labels), currency: c.salary_currency,
    };
    const cfg = kit.mergeCfg({}, { language: c.language, show: { signature: true } });
    const html = registry.get("EMPLOYMENT_CONTRACT").build(
      data, cfg, { legal_name: ENT.legal_name, address: ENT.address, rccm: "RC/DLA/2015/B/1234" }, null,
    );
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const buf = Buffer.from(await page.pdf({ format: "A4", printBackground: true }));
    await page.close();
    // Counting /Type /Page objects, excluding /Pages (the tree node).
    const pages = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    worst = Math.max(worst, pages);
    console.log(`${(extra.kind || c.clause_library_key).padEnd(13)}${lang}    ${String(data.articles.length).padStart(5)}  ${String(pages).padStart(6)}`);
  }
  await browser.close();
  console.log(`\nworst case: ${worst} pages`);
  process.exit(worst > 4 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
