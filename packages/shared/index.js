"use strict";
/**
 * @praxis/shared — the single definition of "valid" for payloads that cross
 * the API/client boundary. See README.md in this directory for why it is
 * CommonJS, why Zod is a peer dependency, and how to add a schema.
 */
const common = require("./schemas/common");
const finalInvoice = require("./schemas/final-invoice");
const journalEntry = require("./schemas/journal-entry");
const clientMaster = require("./schemas/client-master");
const supplierMaster = require("./schemas/supplier-master");
const partyCommon = require("./schemas/party-common");
const partyConfig = require("./schemas/party-config");
const entityCommon = require("./schemas/entity-common");
const siteSettings = require("./schemas/site-settings");
const callSummary = require("./schemas/call-summary");
const dictionaryPosting = require("./schemas/dictionary-posting");
const expenseRate = require("./schemas/expense-rate");
const clientPortal = require("./schemas/client-portal");
const ledger = require("./rules/ledger");
const marks = require("./rules/marks");
const entityRoute = require("./rules/entity-route");
const linkDetect = require("./rules/link-detect");
const notificationInterrupt = require("./rules/notification-interrupt");
const notificationEmailDefault = require("./rules/notification-email-default");
const workSchedule = require("./rules/work-schedule");
const quickPin = require("./rules/quick-pin");
const dictionarySibling = require("./rules/dictionary-sibling");
const coverage = require("./rules/coverage");
const pwaDesign = require("./pwa-design");
const countries = require("./data/countries");
const currencies = require("./data/currencies");
const timezones = require("./data/timezones");
const legalForms = require("./data/legal-forms");
const taxRegimes = require("./data/tax-regimes");
const incoterms = require("./data/incoterms");
const serviceScope = require("./rules/service-scope");
const emailDomain = require("./rules/email-domain");
const quoteRequest = require("./schemas/quote-request");
const quotation = require("./schemas/quotation");
const search = require("./schemas/search");

// Named `exports.x =` assignments, NOT `module.exports = { x }`.
//
// Both are identical to Node, so the API is unaffected — but the client is
// BUNDLED, and cjs-module-lexer (which esbuild and Rollup both use to discover
// a CommonJS module's named exports) cannot see through the object-literal
// form. With `module.exports = { … }` the bundlers found no named exports at
// all: `vite build` failed with `"finalInvoice" is not exported by
// packages/shared/index.js`, and in dev the import silently resolved to
// `undefined` — a form arrived at with no validation and a blank screen when
// zodResolver was handed it. See client/config/shared-alias.ts.
exports.common = common;
exports.finalInvoice = finalInvoice;
exports.journalEntry = journalEntry;
exports.clientMaster = clientMaster;
exports.supplierMaster = supplierMaster;
// Nested master-data resources shared by both masters (contacts, addresses,
// banks, documents, registrations, beneficial owners).
exports.partyCommon = partyCommon;
// Per-tenant field-requirement policy applied on top of the shape schemas.
exports.partyConfig = partyConfig;
// Nested resources owned by a CORPORATE ENTITY (people & shareholding, contacts,
// addresses, registrations, establishments). Deliberately separate from
// partyCommon — same mechanism, different meaning. See schemas/entity-common.js.
exports.entityCommon = entityCommon;
// Website settings — theme, social links, partners, credentials, the group
// About, leadership and an entity's public story. Shared because every one of
// them is a FORM: the settings screen must refuse exactly what the API refuses,
// or a tenant learns their colour was invalid from a 422 after pressing Save.
exports.siteSettings = siteSettings;
// The call summary contract (guide §4.10): the API parses the provider's JSON
// with it, the caller's screen renders and edits the stored draft with it.
// Shared because the draft is EDITED before it is sent — a shape the client
// believes legal and the API refuses is a draft nobody can send.
exports.callSummary = callSummary;
// The AI-suggested OHADA posting of a dictionary line (meeting 6, F3): the API
// parses the model's answer and the wizard's request with it, the wizard sends
// the provenance it saves with. One shape, so a suggestion the screen shows is
// one the API will take.
exports.dictionaryPosting = dictionaryPosting;
// An expense rate and its VAT basis (meeting 6, F4): the rate dialog previews
// "72 700 TTC = 60 964 HT at 19,25 %" with htFromTtc and the API stores the HT
// it computes with the same function — one division, so the saved rate is the
// one the dialog showed.
exports.expenseRate = expenseRate;
// The client portal's staff-side forms (tenant review 29 Sep 2026, PR 1):
// "Request from client", Accept with the fields a KYC document is filed with,
// and "Send by email" on a team message. Shared because the Accept dialog must
// ask for exactly the fields the API refuses an accept without.
exports.clientPortal = clientPortal;
// entity_ref → the screen that shows it. Shared because the API stamps
// `notification.link_url` from it at write time and the client resolves it
// again at draw time for every row written before that column existed.
exports.entityRoute = entityRoute;
// What in a message body is a link. Shared because the API decides which URLs to
// spend a fetch on and what to store, and the client decides what is clickable —
// two copies disagree and the visible failure is a message with nothing to click.
exports.linkDetect = linkDetect;
// Which notifications may interrupt — sound, hold the banner, vibrate.
// Shared because the API stamps it onto the push payload, the socket
// listener uses it to decide whether to make a noise, and the Preferences
// matrix draws the default from it for a user who has set none.
exports.notificationInterrupt = notificationInterrupt;
// Which categories email by default (the tasks opt-out exception to email's
// opt-in rule). Shared for the same reason the interrupt rule is: the API
// hands the default to the EMAIL preference read, and the Preferences matrix
// draws its checkbox from it — two callers, one answer, no drift.
exports.notificationEmailDefault = notificationEmailDefault;
// What a Quick PIN is and which ones are refused. Shared because the API refuses
// a weak PIN at registration and My security says so as the user types — two
// lists disagree, and the visible failure is a 422 after pressing Save.
exports.quickPin = quickPin;
// One service, several fulfilment modes (débours / own cost / deposit / own
// service): the mode each direction stands for, the one question a picker asks,
// the preset for a context and the mismatch guard. Shared because the API
// stamps the mode and presets Suggest, and every picker draws the question and
// the guard from the same table (meeting 6, F2).
exports.dictionarySibling = dictionarySibling;
// "Where it operates" (meeting 6, 3.5): what a complete coverage row is, and
// which stored rows name a place in another country (Libreville under GB).
// Shared because the Story tab blocks the save with the same answer the API
// refuses with, and the API flags stored rows with the rule the tab explains.
exports.coverage = coverage;
// Canonical ISO country reference (code, name, phone, currency, per-jurisdiction
// registration requirements) — the API, the seed and the client picker's source.
/*
 * design/palette.js and design/color.js are DELIBERATELY NOT re-exported here,
 * and will stay that way until PR 2 of doc/PUBLIC_WEB_EXPERIENCE_GUIDE.md wires
 * both sides to them.
 *
 * Two reasons, and the second is the one that matters:
 *
 *   1. `check:schemas` requires every domain on this object to be imported by
 *      BOTH the API and the client. The palette engine is imported by neither
 *      yet — its consumers arrive with the theme endpoint and the appearance
 *      preview — so listing it here would be claiming a contract that does not
 *      exist, and the gate is right to fail it.
 *   2. This entry point pulls Zod and the ISO country and currency tables.
 *      public-web has ~11 kB of gzipped headroom in its first-paint budget and
 *      must import `@praxis/shared/design/palette` by deep path, which needs
 *      nothing from here. Re-exporting would advertise the expensive path as
 *      the normal one.
 */
exports.countries = countries;
// Canonical ISO 4217 currency reference (code, name, symbol, decimals, numeric,
// and the countries that use each). The currency module enriches tenant rows
// from it and the Smart Currency Picker searches it — by country too. See
// data/currencies.js.
exports.currencies = currencies;
// Canonical IANA tzdb catalogue — all geographic zones plus UTC. Deprecated
// names are search aliases only, so every picker stores one modern identifier;
// API validators consume the same catalogue through schemas/common.js.
exports.timezones = timezones;
// ISO 20275/GLEIF v1.6 plus the verified OHADA Phase-1 supplement. Country-aware
// picker, API and persisted reference validation all consume this one catalogue.
exports.legalForms = legalForms;
// Cameroon tax regimes (REEL, SIMPLIFIE, LIBERATOIRE, FRANCHISE, NORMAL, FORFAIT) —
// the picker, the API schema and the migration all read from one file.
exports.taxRegimes = taxRegimes;
// NOTE: expectedRegistrations() lives in ./data/registrations.js as a ready
// module but is deliberately NOT re-exported here yet. `check:schemas` requires
// every index export to be consumed by BOTH the API and the client; the two
// consumers (the create form and the backend registration validator) land in
// PR3-B, and this export is wired up there — exporting it now would trip the
// gate as an unused "third definition".
// Domain INVARIANTS, not shape. See rules/ledger.js for why they are not a
// Zod refinement.
exports.ledger = ledger;
// Not a Zod schema either — the marks & numbers FORMAT, which must stay
// byte-identical to the legacy generator because five printed documents read
// the string it produces. The API recomputes on every container write; the
// client previews it live under the container editor. See rules/marks.js.
exports.marks = marks;
// Not a Zod schema — the shared *resolution* of the installed-app design (see
// pwa-design.js). It crosses the same boundary for the same reason: the API
// renders the home-screen PNG from it and the client renders the preview.
exports.pwaDesign = pwaDesign;
// The working week per day (worked / hours / on-site or remote). The employee
// form draws it, the API validates it, and both print the contract's line
// through summarise() — so `employee.working_hours` cannot drift from the grid.
exports.workSchedule = workSchedule;
// Incoterms 2020 (tenant review, meeting 6, PR 2): the eleven terms, their
// names, and which four are sea-only. It was written out four times and the
// copies disagreed; the API, the staff form and every service type's own list
// read this one. The website and the portal get it through the API.
exports.incoterms = incoterms;
// Where a service type sits in a quote request: its card (transport_mode) and
// its flow (from territory), plus the key ladder that defaults the card. The
// service-type form suggests a card from it and the API stores and serves it.
exports.serviceScope = serviceScope;
// Which part of an email says who the sender works for — and the public
// webmail domains where it says nothing. The API matches a requester to a
// client with it; the quote-request form explains why it did not suggest one.
exports.emailDomain = emailDomain;
// Quote request payloads for all three doors — the desk, the portal and the
// public website — so "a valid request" is one definition (meeting 6, PR 2).
exports.quoteRequest = quoteRequest;
// Quotations (meeting 6, PR 4): "Create quotation" on a costing, the per-
// document family order, Settings › Commercial's target margin, and a client
// declining in the portal. Shared because the costing sheet must offer the
// button on exactly the statuses the API prices from, and the settings form
// must refuse exactly the margin the API refuses.
exports.quotation = quotation;
// Search that finds everything (meeting 6, PR 4 — G5): the /search query the
// palette sends and the API validates, the ONE synonym list both read (the
// palette to match pages, the API to read "facture 0042" as a type hint), and
// the accent fold both compare with — the same table as 14382's search_fold().
exports.search = search;
