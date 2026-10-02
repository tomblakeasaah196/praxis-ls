/**
 * Accept-and-sign in the client portal — the signature programme's flow, for
 * any signable offer (client portal PR 2 for proposals; meeting 6, owner
 * decision G4, for commercial quotations: "e-signature, exactly like
 * proposals").
 *
 * ── THE SIGNATURE IS THE SIGNATURE PROGRAMME'S, NOT A SECOND ONE ───────────
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md already built what "e-sign" means here:
 * a signature request with the counterparty as an ON-FILE party, an emailed
 * six-digit code bound to the document's canonical hash (§6.4), a stamp or a
 * drawn mark, and a signature row the verification portal can answer for. The
 * portal does not invent a lighter one beside it — a click that "counts as a
 * signature" would be exactly the evidence gap that programme closed. So:
 *
 *   start    → the request (opened on behalf of whoever sent the offer, the
 *              portal user as its one ON-FILE counterparty — their address is
 *              on file because the tenant invited it), dispatched without the
 *              email link (they are already here), and the code sent.
 *   sign     → the code verified, then `signature_public.complete`, which
 *              re-derives the document's hash — an offer edited since the code
 *              was sent is refused. The caller then moves the offer itself.
 *
 * The party's signing token never reaches the browser: each step mints a
 * fresh one server-side (`remintSignToken`) and hands it to the public
 * service. The browser proves who it is with the portal session and the code.
 *
 * One kit per document type — `signingKit({ docType, refOf, senderOf })` —
 * so a proposal and a quotation are signed by the same code, and a fix to one
 * is a fix to both.
 */
"use strict";

const requestService = require("../vault/signature_request/signature_request.service");
const signing = require("../vault/signature_public/signature_public.service");
const presets = require("../../services/signatures/presets");
const { AppError } = require("../../utils/errors");

/** The two cards a signed-in client can complete here: the others hand off (QES) or go to paper. */
const DIGITAL = ["STAMP", "DRAWN"];
const langOf = (lang) => (String(lang || "").toLowerCase().startsWith("fr") ? "fr" : "en");

/**
 * @param {object} opts
 * @param {string} opts.docType   the signable type (document_vault.types)
 * @param {(id: string) => string} opts.refOf   id → entity_ref
 * @param {(c, row) => Promise<string>} opts.senderOf   who stands behind the request
 */
function signingKit({ docType, refOf, senderOf }) {
  /** What the tenant lets a signed-in client sign this with, right now. */
  async function digitalCards(c, lang) {
    try {
      const menu = await presets.resolveMenu(c, { docType, language: lang });
      return menu.cards.filter((card) => DIGITAL.includes(card.preset_code)).map((card) => ({
        preset_code: card.preset_code,
        label: card.label,
        blurb: card.blurb || null,
      }));
    } catch {
      // An unsignable configuration reads as "no e-signature", which the portal
      // answers with a confirmed accept — never as a broken offer.
      return [];
    }
  }

  /** The client's signature on the offer, if one exists — for "Signed by … on …". */
  async function signatureOf(c, id) {
    const { rows } = await c.query(
      `SELECT signature_id, signer_name, signer_role, signed_at, created_at, visual_mark, assurance_level, verify_code
         FROM document_signature
        WHERE entity_ref = $1 AND party = 'EXTERNAL' AND revoked_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [refOf(id)],
    );
    const s = rows[0];
    if (!s) return null;
    return {
      signer_name: s.signer_name,
      signer_role: s.signer_role || null,
      signed_at: s.signed_at || s.created_at,
      mark: s.visual_mark,
      assurance: s.assurance_level,
      verify_code: s.verify_code ? String(s.verify_code) : null,
    };
  }

  /** This person's open party on this offer's open request, if there is one. */
  async function openParty(c, { id, email }) {
    const { rows } = await c.query(
      `SELECT p.party_id, p.request_id, p.status
         FROM signature_party p
         JOIN signature_request r ON r.request_id = p.request_id
        WHERE r.entity_ref = $1 AND r.status IN ('DRAFT','SENT','PARTIALLY_SIGNED')
          AND lower(p.email::text) = lower($2) AND p.status IN ('PENDING','SENT','VIEWED')
        ORDER BY r.created_at DESC LIMIT 1`,
      [refOf(id), email],
    );
    return rows[0] || null;
  }

  /** A fresh token for this party, used and forgotten inside one request. */
  async function tokenFor(c, partyId) {
    const out = await requestService.remintSignToken(c, { partyId });
    if (!out) throw new AppError("SIGNING_CLOSED", "This signature request is closed. Reload the page.", 409);
    return out.token;
  }

  /** Open (or reuse) the signing request and email the code. */
  async function start(c, { row, id, me, grantId = null, lang = "en", tenantName = "" }) {
    const cards = await digitalCards(c, langOf(lang));
    if (!cards.length) throw new AppError("ESIGN_UNAVAILABLE", "Online signing is not available for this document", 409);

    let party = await openParty(c, { id, email: me.email });
    if (party && party.status === "PENDING") {
      // Created but never sent (an earlier attempt stopped half-way): send it now.
      const actor = { user_id: await senderOf(c, row) };
      await requestService.dispatch(c, { id: party.request_id, actor, language: langOf(lang), sendEmail: null });
      party = await openParty(c, { id, email: me.email });
    }
    if (!party) {
      const actor = { user_id: await senderOf(c, row) };
      const request = await requestService.create(c, {
        entityRef: refOf(id),
        docType,
        allowPaper: false,
        parties: [{
          party_kind: "COUNTERPARTY",
          source: "ON_FILE",
          // The address is on file because the tenant invited it to the portal.
          source_ref: grantId ? `portal_access:${grantId}` : `portal_user:${me.portal_user_id}`,
          full_name: me.full_name || me.email,
          party_role: null,
          email: me.email,
          language: langOf(lang),
        }],
        actor,
        language: langOf(lang),
      });
      // Dispatched WITHOUT the email link: the signer is already in the portal.
      await requestService.dispatch(c, { id: request.request_id, actor, language: langOf(lang), sendEmail: null });
      party = await openParty(c, { id, email: me.email });
      if (!party) throw new AppError("SIGNING_CLOSED", "The signature request could not be opened", 409);
    }

    const token = await tokenFor(c, party.party_id);
    const view = await signing.resolve(c, { token, lang: langOf(lang) });
    const code = await signing.sendOtp(c, { token, lang: langOf(lang), tenantName });
    return {
      signer: { full_name: view.signer.full_name, email_masked: view.signer.email_masked },
      cards: view.menu.cards.filter((card) => DIGITAL.includes(card.preset_code)).map((card) => ({
        preset_code: card.preset_code, label: card.label, blurb: card.blurb || null,
      })),
      otp: code,
    };
  }

  /** Send the code again (the same row; the programme caps resends). */
  async function resend(c, { id, me, lang = "en", tenantName = "" }) {
    const party = await openParty(c, { id, email: me.email });
    if (!party) throw new AppError("SIGNING_NOT_STARTED", "Start signing first", 409);
    return { otp: await signing.sendOtp(c, { token: await tokenFor(c, party.party_id), lang: langOf(lang), tenantName }) };
  }

  /**
   * Verify the code, then sign. The order is the programme's: the code is
   * checked against THIS payload, and `complete` re-derives the hash.
   * Returns the programme's result; the caller moves the offer.
   */
  async function sign(c, { id, me, code, presetCode, fullName = null, partyRole = null, markImageB64 = null, ip = null, userAgent = null, lang = "en", origin = null, slug = null }) {
    if (!DIGITAL.includes(presetCode)) throw new AppError("PRESET_NOT_ALLOWED", "Choose a stamp or a drawn signature", 422);
    const party = await openParty(c, { id, email: me.email });
    if (!party) throw new AppError("SIGNING_NOT_STARTED", "Start signing first", 409);
    const token = await tokenFor(c, party.party_id);
    await signing.verifyOtp(c, { token, code, ip, userAgent });
    const signed = await signing.complete(c, {
      token, presetCode, fullName, partyRole, markImageB64, ip, userAgent, lang: langOf(lang), origin, slug,
    });
    if (!signed || signed.signed !== true) {
      throw new AppError("SIGNING_INCOMPLETE", "The signature could not be completed", 409);
    }
    return signed;
  }

  /** A decline closes the person's open signing request with the same reason. */
  async function declineOpen(c, { id, me, reasonCode, note = null, lang = "en" }) {
    const party = await openParty(c, { id, email: me.email });
    if (party) {
      await signing.declineSigning(c, { token: await tokenFor(c, party.party_id), reasonCode, note, lang: langOf(lang) });
    }
  }

  return { docType, DIGITAL, digitalCards, signatureOf, openParty, start, resend, sign, declineOpen };
}

/** The DECLINE vocabulary — one list wherever a client said no. */
async function declineReasons(c, lang = "en") {
  return (await presets.reasons(c, { kind: "DECLINE" })).map((r) => ({
    reason_code: r.reason_code, label: langOf(lang) === "fr" ? r.label_fr : r.label_en,
  }));
}

/** A reason from the list, or a 422 naming the ones there are. */
async function chosenReason(c, reasonCode) {
  const reasons = await presets.reasons(c, { kind: "DECLINE" });
  const chosen = reasons.find((r) => r.reason_code === reasonCode);
  if (!chosen) {
    throw new AppError("UNKNOWN_DECLINE_REASON", "Choose a reason from the list", 422, { available: reasons.map((r) => r.reason_code) });
  }
  return chosen;
}

module.exports = { signingKit, declineReasons, chosenReason, DIGITAL, langOf };
