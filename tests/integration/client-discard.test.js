"use strict";

/**
 * Meeting 6, PR 3 — Definition of done #8 (register 3.6), against a real
 * tenant:
 *
 *   - a CINECAM-style DRAFT client with no history is deleted in one
 *     transaction with its own contacts, addresses, registrations, documents,
 *     portal grant and unused invite, and the audit trail keeps a full
 *     snapshot;
 *   - a client with one operations file is refused — "Deactivate instead" —
 *     and nothing of it is touched;
 *   - an ACTIVE client is refused the same way.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant; self-skips
 * otherwise.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("Discard a draft client (meeting 6, 3.6)", () => {
  let pool;
  let c;
  const STAMP = Date.now();
  const leftovers = { clients: [], dossiers: [], portalUsers: [] };

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    c = await pool.connect();
  });
  afterAll(async () => {
    if (c) {
      for (const id of leftovers.dossiers) await c.query("DELETE FROM dossier WHERE dossier_id = $1", [id]);
      for (const id of leftovers.clients) await c.query("DELETE FROM client_master WHERE client_id = $1", [id]).catch(() => {});
      for (const id of leftovers.portalUsers) {
        await c.query("DELETE FROM portal_invite WHERE portal_user_id = $1", [id]);
        await c.query("DELETE FROM portal_user WHERE portal_user_id = $1", [id]);
      }
      c.release();
    }
    if (pool) await pool.end();
  });

  const service = () => require("../../src/modules/master/client_master/client_master.service");

  async function draftClient(name) {
    const row = await service().create(c, {
      data: {
        name,
        legal_name: name,
        country_code: "CM",
        phone: "+237699000000",
        email: `client.${STAMP}.${name.length}@example.org`,
        primary_contact: { name: "Test Contact", email: `contact.${STAMP}@example.org` },
        primary_address: { line1: "Rue de la Joie", city: "Douala", country_code: "CM" },
      },
      actor: { user_id: null },
    });
    leftovers.clients.push(row.client_id);
    return row;
  }

  test("a CINECAM-style draft with no history is deleted with its own children, and audited in full", async () => {
    const cl = await draftClient(`Cinecam Test ${STAMP}`);
    expect(cl.registration_status).toBe("DRAFT");
    const email = `cinecam.${STAMP}@example.org`;
    await c.query("INSERT INTO portal_access (portal, subject_email, client_id) VALUES ('CLIENT', $1, $2)", [email, cl.client_id]);
    const { rows: [pu] } = await c.query(
      "INSERT INTO portal_user (email, password_hash) VALUES ($1, 'x') RETURNING portal_user_id",
      [email],
    );
    leftovers.portalUsers.push(pu.portal_user_id);
    await c.query(
      "INSERT INTO portal_invite (portal_user_id, token_hash, purpose, expires_at) VALUES ($1, $2, 'INVITE', now() + interval '7 days')",
      [pu.portal_user_id, `hash-${STAMP}`],
    );

    const check = await service().discardCheck(c, { id: cl.client_id });
    expect(check).toMatchObject({ can_discard: true, reason: null, history: [] });

    const out = await service().discard(c, { id: cl.client_id, actor: { user_id: null } });
    expect(out.discarded).toBe(true);
    expect(out.removed.portal_grants).toBe(1);
    expect(out.removed.portal_invites).toBe(1);

    const gone = async (sql) => (await c.query(sql, [cl.client_id])).rowCount;
    expect(await gone("SELECT 1 FROM client_master WHERE client_id = $1")).toBe(0);
    expect(await gone("SELECT 1 FROM client_contact WHERE client_id = $1")).toBe(0);
    expect(await gone("SELECT 1 FROM client_address WHERE client_id = $1")).toBe(0);
    expect(await gone("SELECT 1 FROM portal_access WHERE client_id = $1")).toBe(0);
    expect((await c.query("SELECT 1 FROM portal_invite WHERE portal_user_id = $1", [pu.portal_user_id])).rowCount).toBe(0);

    const { rows: [entry] } = await c.query(
      "SELECT before_json, after_json, is_sensitive FROM immutable_ledger WHERE action = 'client.discarded' AND entity_ref = $1",
      [`client:${cl.client_id}`],
    );
    expect(entry.is_sensitive).toBe(true);
    expect(entry.after_json).toBeNull();
    expect(entry.before_json.client).toMatchObject({ client_id: cl.client_id, name: cl.name, registration_status: "DRAFT" });
    expect(entry.before_json.contacts).toHaveLength(1);
    expect(entry.before_json.addresses).toHaveLength(1);
    expect(entry.before_json.portal_grants).toEqual([expect.objectContaining({ subject_email: email })]);
  });

  test("a client with one operations file is refused — Deactivate instead — and left as it was", async () => {
    const cl = await draftClient(`Has A File ${STAMP}`);
    const { rows: [file] } = await c.query(
      "INSERT INTO dossier (ref, client_id) VALUES ($1, $2) RETURNING dossier_id",
      [`T-${STAMP}`, cl.client_id],
    );
    leftovers.dossiers.push(file.dossier_id);

    const check = await service().discardCheck(c, { id: cl.client_id });
    expect(check.can_discard).toBe(false);
    expect(check.reason).toBe("HAS_HISTORY");
    expect(check.history).toEqual([{ key: "operations_files", count: 1, label: "operations files" }]);

    await expect(service().discard(c, { id: cl.client_id, actor: { user_id: null } })).rejects.toMatchObject({
      code: "CLIENT_HAS_HISTORY",
      status: 409,
      message: expect.stringMatching(/1 operations files.*Deactivate instead/),
    });
    expect((await c.query("SELECT 1 FROM client_master WHERE client_id = $1", [cl.client_id])).rowCount).toBe(1);
    expect((await c.query("SELECT 1 FROM client_contact WHERE client_id = $1", [cl.client_id])).rowCount).toBe(1);
  });

  test("an active client is not a draft and is refused", async () => {
    const cl = await draftClient(`Active One ${STAMP}`);
    await c.query("UPDATE client_master SET registration_status = 'ACTIVE' WHERE client_id = $1", [cl.client_id]);
    await expect(service().discard(c, { id: cl.client_id, actor: { user_id: null } })).rejects.toMatchObject({
      code: "CLIENT_NOT_DRAFT",
      status: 409,
    });
  });
});
