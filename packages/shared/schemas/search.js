"use strict";
/**
 * Search that finds everything (tenant review, meeting 6, PR 4 — G5): what
 * the ⌘K palette and the API's `/search` must agree on.
 *
 *   query      GET /search — the term, the record types asked for, and how
 *              many per group. The palette refuses to send what this refuses.
 *   SYNONYMS   THE one maintained synonym list. Each group names ONE thing, in
 *              English and French, with the words people actually type for it:
 *              "devis" and "cotation" are how a Douala desk says "quotation".
 *              The palette matches a page whose title (or its registry
 *              synonyms) is in a group when ANY word of that group is typed;
 *              the API reads a group word at either end of the term as a type
 *              hint ("facture 0042" searches invoices for 0042).
 *   conceptOf  the group a word belongs to, folded (case and accents ignored).
 *
 * Add a word where people use one we do not know. Never put one word in two
 * groups: `tests/unit/search.test.js` refuses it, because an ambiguous word
 * would send "offre" to whichever group happened to be read first.
 */
const { z } = require("zod");

const TYPES_RE = /^[a-z_]+(,[a-z_]+)*$/;

const query = z
  .object({
    q: z.string().trim().min(2, "Type at least two letters.").max(80, "Shorten the search to 80 characters."),
    types: z.string().regex(TYPES_RE, "Record types are comma-separated keys.").max(400).optional(),
    limit: z.coerce.number().int().min(1).max(10).optional(),
  })
  .strict();

/**
 * `key` is a record type where one exists (it is then also a type hint for the
 * API); the words are matched folded. Multi-word entries match as a phrase.
 */
const SYNONYMS = Object.freeze([
  { key: "quotation", words: ["quotation", "quotations", "quote", "quotes", "devis", "cotation", "cotations", "offer", "offers", "offre", "offres", "estimate", "estimation"] },
  { key: "quote_request", words: ["quote request", "quote requests", "request for quotation", "requests for quotation", "rfq", "demande de devis", "demandes de devis", "demande de cotation", "demande de prix"] },
  { key: "proposal", words: ["proposal", "proposals", "proposition", "propositions", "offre commerciale", "proposition commerciale"] },
  { key: "invoice", words: ["invoice", "invoices", "facture", "factures", "bill", "billing", "facturation"] },
  { key: "proforma", words: ["proforma", "proformas", "pro forma", "pro-forma", "facture proforma", "advance invoice", "avance"] },
  { key: "receipt", words: ["receipt", "receipts", "recu", "recus", "encaissement", "encaissements", "payment received", "paiement recu"] },
  { key: "file", words: ["file", "files", "operations file", "dossier", "dossiers", "operation", "operations", "shipment", "shipments", "expedition", "expeditions", "job"] },
  { key: "client", words: ["client", "clients", "customer", "customers", "compte client", "donneur d'ordre"] },
  { key: "supplier", words: ["supplier", "suppliers", "fournisseur", "fournisseurs", "vendor", "vendors", "prestataire", "prestataires"] },
  { key: "contact", words: ["contact", "contacts", "interlocuteur", "interlocuteurs", "contact person"] },
  { key: "costing", words: ["costing", "costings", "cost sheet", "cost sheets", "prix de revient", "fiche de cout", "fiche de couts"] },
  { key: "purchase_order", words: ["purchase order", "purchase orders", "po", "bon de commande", "bons de commande", "bdc"] },
  { key: "employee", words: ["employee", "employees", "staff", "employe", "employes", "salarie", "salaries", "personnel", "agent", "agents"] },
  { key: "treasury_account", words: ["treasury", "treasury account", "bank account", "bank", "banque", "caisse", "tresorerie", "compte bancaire", "mobile money"] },
  { key: "dictionary_item", words: ["financial dictionary", "dictionary", "dictionnaire", "dictionnaire financier", "rubrique", "rubriques", "line item", "debours", "disbursement", "disbursements"] },
  { key: "service_type", words: ["service type", "service types", "type de service", "types de service", "prestation", "prestations"] },
  { key: "document", words: ["document", "documents", "vault", "coffre", "coffre-fort", "piece", "pieces", "piece jointe", "scan", "scans"] },
  { key: "lead", words: ["lead", "leads", "prospect", "prospects", "piste", "pistes"] },
  { key: "opportunity", words: ["opportunity", "opportunities", "opportunite", "opportunites", "deal", "deals", "affaire", "affaires", "pipeline"] },
  { key: "transit_order", words: ["transit order", "transit orders", "ordre de transit", "ordres de transit", "ot"] },
  { key: "delivery_note", words: ["delivery note", "delivery notes", "bon de livraison", "bons de livraison", "proof of delivery"] },
  { key: "cash_request", words: ["cash request", "cash requests", "demande de fonds", "demandes de fonds", "df", "decaissement"] },
  { key: "supplier_invoice", words: ["supplier invoice", "supplier invoices", "facture fournisseur", "factures fournisseurs", "achat", "achats"] },
  { key: "corporate_entity", words: ["corporate entity", "corporate entities", "entity", "entities", "entite", "entites", "societe", "filiale", "company"] },
  { key: "vehicle", words: ["vehicle", "vehicles", "vehicule", "vehicules", "truck", "trucks", "camion", "camions", "fleet", "flotte"] },
  // Pages with no record type of their own — still one thing, many words.
  { key: "settings", words: ["settings", "parametres", "reglages", "configuration", "preferences", "admin", "administration"] },
  { key: "payroll", words: ["payroll", "paie", "bulletin", "bulletins", "salary", "salaire", "salaires"] },
  { key: "tax", words: ["tax", "taxes", "impot", "impots", "fiscalite", "tva", "vat", "dsf"] },
  { key: "journal", words: ["journal", "journals", "journaux", "ecriture", "ecritures", "journal entry", "ledger", "grand livre"] },
  { key: "approval", words: ["approval", "approvals", "approbation", "approbations", "validation", "validations", "a valider"] },
  { key: "message", words: ["message", "messages", "chat", "inbox", "boite de reception", "conversation", "conversations"] },
  { key: "warehouse", words: ["warehouse", "entrepot", "magasin", "stock", "inventory", "inventaire", "wms"] },
  { key: "leave", words: ["leave", "conge", "conges", "absence", "absences", "holiday", "vacation"] },
]);

const FOLD_FROM = "àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľŀłñńņňòóôõöøōŏőœŕŗřśŝşšţťŧùúûüũūŭůűųŵýÿŷźżžæ";
const FOLD_TO = "aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiiijklllllnnnnoooooooooorrrsssstttuuuuuuuuuuwyyyzzza";
const FOLD = new Map([...FOLD_FROM].map((ch, i) => [ch, FOLD_TO[i]]));
const fold = (s) => {
  let out = "";
  for (const ch of String(s == null ? "" : s).toLowerCase()) out += FOLD.get(ch) || ch;
  return out.replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
};

const BY_WORD = new Map();
for (const g of SYNONYMS) for (const w of g.words) BY_WORD.set(fold(w), g.key);

/** The group a word (or phrase) belongs to, or null. */
const conceptOf = (word) => BY_WORD.get(fold(word)) || null;

module.exports = { query, SYNONYMS, conceptOf, fold, FOLD_FROM, FOLD_TO };
