/**
 * The quote engine's questions, EN and FR (SmartLS website v2, PR 3): which
 * way the goods go, whether the visitor knows their Incoterm, buying or
 * selling, where our work begins and ends, who insures, and the place names
 * those questions offer. Mounted at `site.quoteEngine`.
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
  direction: "Are you importing or exporting?",
  directionIMPORT: "Importing",
  directionEXPORT: "Exporting",
  knows: "Do you know your Incoterm?",
  knowsYES: "Yes",
  knowsNO: "No",
  incoterm: "Which Incoterm?",
  party: "Are you buying or selling?",
  partyBUYER: "Buying",
  partySELLER: "Selling",
  start: "Where should our work begin?",
  end: "Where should it end?",
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
  insuredBUYER: "Has your supplier insured the voyage?",
  insuredSELLER: "Will you insure the voyage for your buyer?",
  insuredYES: "Yes",
  insuredNO: "No",
  member: "Which of these fits?",
  handle: "What We Handle",
} as const;

export const fr = {
  direction: "Importez-vous ou exportez-vous ?",
  directionIMPORT: "J’importe",
  directionEXPORT: "J’exporte",
  knows: "Connaissez-vous votre Incoterm ?",
  knowsYES: "Oui",
  knowsNO: "Non",
  incoterm: "Quel Incoterm ?",
  party: "Achetez-vous ou vendez-vous ?",
  partyBUYER: "J’achète",
  partySELLER: "Je vends",
  start: "Où notre travail doit-il commencer ?",
  end: "Où doit-il s’arrêter ?",
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
  insuredBUYER: "Votre fournisseur a-t-il assuré le voyage ?",
  insuredSELLER: "Assurez-vous le voyage pour votre acheteur ?",
  insuredYES: "Oui",
  insuredNO: "Non",
  member: "Lequel correspond ?",
  handle: "Ce que nous prenons en charge",
} as const;
