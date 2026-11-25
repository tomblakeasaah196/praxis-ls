/**
 * The quote engine's questions, EN and FR (SmartLS website v2, PR 3): which
 * way the goods go, whether the visitor knows their Incoterm, buying or
 * selling, where our work begins and ends, who insures, and the place names
 * those questions offer. Mounted at `site.quoteEngine`. The questions themselves are
 * sentences, not labels, so they live in `quote-steps-copy.ts` as prose and keep
 * their sentence case.
 *
 * Its own file because only the quote wizard's lazy "Your Terms" step reads
 * it, so no other page downloads it (the reason `quote-steps-copy.ts` and
 * `careers-copy.ts` exist). Every key here is a LABEL (Title Case, or a
 * question, which the rule leaves as a sentence), so the section is classified
 * whole in `scripts/gen/site-copy-case.js`. The prose of the step (its hint,
 * the desk sentence, the error) stays in `quote-steps-copy.ts`.
 *
 * Same rules as that file: no imports, no expressions, two object literals.
 */

export const en = {
  directionIMPORT: "Importing",
  directionEXPORT: "Exporting",
  knowsYES: "Yes",
  knowsNO: "No",
  partyBUYER: "Buying",
  partySELLER: "Selling",
  pointSUPPLIER_PREMISES_BUYER: "Your Supplier's Premises",
  pointSUPPLIER_PREMISES_SELLER: "Your Premises",
  pointORIGIN_PORT_SEA: "Port of Loading",
  pointORIGIN_PORT_AIR: "Airport of Departure",
  pointORIGIN_PORT_ANY: "Port or Airport of Loading",
  pointDESTINATION_PORT_SEA: "Port of Arrival",
  pointDESTINATION_PORT_AIR: "Airport of Arrival",
  pointDESTINATION_PORT_ANY: "Port or Airport of Arrival",
  pointPREMISES_BUYER: "Your Premises",
  pointPREMISES_SELLER: "Your Buyer's Premises",
  pointPREMISES_DUTY_PAID_BUYER: "Your Premises, Duties Paid",
  pointPREMISES_DUTY_PAID_SELLER: "Your Buyer's Premises, Duties Paid",
  insuredYES: "Yes",
  insuredNO: "No",
  handle: "What We Handle",
} as const;

export const fr = {
  directionIMPORT: "J’importe",
  directionEXPORT: "J’exporte",
  knowsYES: "Oui",
  knowsNO: "Non",
  partyBUYER: "J’achète",
  partySELLER: "Je vends",
  pointSUPPLIER_PREMISES_BUYER: "Chez votre fournisseur",
  pointSUPPLIER_PREMISES_SELLER: "Dans vos locaux",
  pointORIGIN_PORT_SEA: "Port de chargement",
  pointORIGIN_PORT_AIR: "Aéroport de départ",
  pointORIGIN_PORT_ANY: "Port ou aéroport de chargement",
  pointDESTINATION_PORT_SEA: "Port d’arrivée",
  pointDESTINATION_PORT_AIR: "Aéroport d’arrivée",
  pointDESTINATION_PORT_ANY: "Port ou aéroport d’arrivée",
  pointPREMISES_BUYER: "Dans vos locaux",
  pointPREMISES_SELLER: "Chez votre acheteur",
  pointPREMISES_DUTY_PAID_BUYER: "Dans vos locaux, droits acquittés",
  pointPREMISES_DUTY_PAID_SELLER: "Chez votre acheteur, droits acquittés",
  insuredYES: "Oui",
  insuredNO: "Non",
  handle: "Ce que nous prenons en charge",
} as const;
