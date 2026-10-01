"use strict";

/**
 * A client's KYC through the portal, against a real schema (tenant review of
 * 29 Sep 2026, PR 1, items 1.1–1.3; definition of done 1 and 2):
 *
 *   - the portal asks for the client's ACTIVATION types — the Attestation de
 *     conformité fiscale included, for a Cameroonian client — plus the
 *     remaining rule types, and never for bank details;
 *   - an RCCM the client sends and staff accept is a VERIFIED document on the
 *     Client 360, filed under its type with the expiry and authority the
 *     Accept dialog asked for; "Missing Business Licence / RCCM" is gone from
 *     the compliance read; and the client sees the file in the portal's own
 *     Library.
 *
 * The services commit their own transactions, so every row this suite makes
 * is removed afterwards. Runs only with DATABASE_URL pointing at a provisioned
 * tenant (search_path = the tenant schema); self-skips otherwise, like every
 * suite in this directory.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("Client KYC through the portal: asked, sent, accepted, filed, visible", () => {
  let pool;
  let c;
  let clientId;
  const svc = require("../../src/modules/portal/portal_client.service");
  const portalRepo = require("../../src/modules/portal/portal.repo");
  const compliance = require("../../src/modules/master/compliance/compliance.service");
  const one = async (sql, params) => (await c.query(sql, params)).rows[0];
  // The smallest file the vault's content sniff accepts as a PDF.
  const pdf = () => {
    const buffer = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "latin1");
    return { buffer, originalname: "rccm.pdf", mimetype: "application/pdf", size: buffer.length };
  };

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    c = await pool.connect();
    clientId = (
      await one(
        "INSERT INTO client_master (name, legal_name, country_code) VALUES ($1, $1, 'CM') RETURNING client_id",
        [`KYC portal trial ${Date.now()}`],
      )
    ).client_id;
  });

  afterAll(async () => {
    if (!c) return;
    if (clientId) {
      // Children first: the requests point at the vault rows, the documents
      // at the client.
      await c.query("DELETE FROM client_request WHERE client_id = $1", [clientId]);
      await c.query("DELETE FROM client_document WHERE client_id = $1", [clientId]);
      await c.query("DELETE FROM document_vault WHERE client_id = $1", [clientId]);
      await c.query("DELETE FROM client_master WHERE client_id = $1", [clientId]);
    }
    c.release();
    await pool.end();
  });

  /* What each open request FILES AS on the Client 360 — its party document
     type (14260). The portal's own `doc_type_code` is the dictionary's code
     ("RCCM"), and a type with no dictionary twin (the Attestation) has none. */
  const typeCode = async () =>
    new Map((await c.query("SELECT document_type_id, code::text AS code FROM party_document_type")).rows.map((t) => [t.document_type_id, t.code]));
  const openRequests = async () => {
    const codes = await typeCode();
    return (await svc.requests(c, { clientId }))
      .filter((r) => r.status === "OPEN")
      .map((r) => ({ ...r, files_as: codes.get(r.party_document_type_id) || null }));
  };
  const openCodes = async () => (await openRequests()).map((r) => r.files_as);

  test("asks for the activation types — the Attestation included — and the rule types, never bank details", async () => {
    const codes = await openCodes();
    // Activation (party_document_type.required_for_activation): the RCCM and,
    // for a client in Cameroon, the Attestation de conformité fiscale.
    expect(codes).toEqual(expect.arrayContaining(["BUSINESS_LICENSE", "FISCAL_COMPLIANCE"]));
    // The remaining GLOBAL client rules, filed under their 14260 twins.
    expect(codes).toEqual(expect.arrayContaining(["TAXPAYER_CARD", "IDENTIFICATION"]));
    // Never bank details: the rule is off and the pairing is filing-only.
    expect(codes).not.toContain("BANK_RIB");
    expect(codes).not.toContain("BANK_DETAILS");
    // One request per type: asking again adds nothing.
    expect((await openCodes()).length).toBe(codes.length);
  });

  test("an RCCM sent and accepted is VERIFIED on the 360, clears the gap, and is in the client's Library", async () => {
    const rccmType = await one("SELECT document_type_id, name FROM party_document_type WHERE code = 'BUSINESS_LICENSE'");
    const missing = `Missing ${rccmType.name}`;
    const gaps = async () => (await compliance.evaluateParty(c, { kind: "client", partyId: clientId })).flags.map((f) => f.message);
    expect(await gaps()).toContain(missing);

    const request = (await openRequests()).find((r) => r.files_as === "BUSINESS_LICENSE");
    expect(request).toBeTruthy();

    // The client sends the scan from the portal …
    const sent = await svc.uploadForRequest(c, {
      clientId, requestId: request.client_request_id, file: pdf(), email: "elisha@goum.cm", name: "Elisha Godwin", slug: "citenant",
    });
    expect(sent.status).toBe("SUBMITTED");

    // … and staff accept it with what the type asks for (expiry, authority).
    await svc.reviewRequest(c, {
      requestId: request.client_request_id,
      decision: "ACCEPT",
      document: { issued_on: "2026-01-15", expires_on: "2031-01-15", issuing_authority: "Greffe du Tribunal de Commerce de Douala" },
      actor: { user_id: null },
    });

    // Client 360 › Documents: one VERIFIED row of that type, with the fields.
    const doc = await one(
      `SELECT document_id, verification_status, expires_on::text AS expires_on, issuing_authority
         FROM client_document WHERE client_id = $1 AND document_type_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [clientId, rccmType.document_type_id],
    );
    expect(doc).toMatchObject({
      verification_status: "VERIFIED",
      expires_on: "2031-01-15",
      issuing_authority: "Greffe du Tribunal de Commerce de Douala",
    });
    const row = await one("SELECT status, client_document_id FROM client_request WHERE client_request_id = $1", [request.client_request_id]);
    expect(row).toEqual({ status: "ACCEPTED", client_document_id: doc.document_id });

    // The gap is gone.
    expect(await gaps()).not.toContain(missing);

    // And the client sees what they sent in the portal's Library — under the
    // portal's own name for it (the dictionary's RCCM), which is what the
    // client asked for and uploaded against.
    const library = await portalRepo.clientDocuments(c, clientId);
    expect(library.find((l) => l.doc_id === sent.answer_doc_id)).toMatchObject({
      doc_type_code: "RCCM",
      original_name: "rccm.pdf",
      status: "VERIFIED",
    });

    // Nothing is asked twice: the RCCM is on file, so no new request opens.
    expect(await openCodes()).not.toContain("BUSINESS_LICENSE");
  });
});
