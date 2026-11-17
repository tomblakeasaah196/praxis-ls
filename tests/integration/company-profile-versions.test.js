"use strict";

/**
 * Company Profile, Sales lean revamp PR 5 (guide §3.6, §4.7), against a real
 * tenant:
 *
 *   - a section save keeps only the words its structure names;
 *   - publish supersedes, and a published version cannot be edited, by the
 *     service or by a statement that goes round it (14560's trigger);
 *   - two first edits at once open ONE draft;
 *   - a share that follows the published version changes when the next one is
 *     published, a pinned share does not;
 *   - an open is recorded, the first one once; revoked and expired links 404.
 *
 * Runs only with DATABASE_URL pointing at a provisioned tenant; self-skips
 * otherwise.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("Company Profile versions and share links (PR 5)", () => {
  let pool;
  let c;
  let c2;
  const service = () => require("../../src/modules/sales/company_profile/company_profile.service");
  const repo = () => require("../../src/modules/sales/company_profile/company_profile.repo");
  const pub = () => require("../../src/modules/sales/company_profile_public/company_profile_public.service");
  const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const STAMP = `t${Date.now()}`;

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    c = await pool.connect();
    c2 = await pool.connect();
  });
  afterAll(async () => {
    if (c) c.release();
    if (c2) c2.release();
    if (pool) await pool.end();
  });

  test("the editor always offers the nine sections", async () => {
    const e = await service().editor(c);
    expect(e.sections.map((s) => s.key)).toHaveLength(9);
    expect(e.sections.find((s) => s.key === "cover").structure.image_key).toBeUndefined();
  });

  test("a save keeps only named words, refuses an over-long one, and two first edits open one draft", async () => {
    const before = await repo().byStatus(c, "DRAFT");
    if (before) await service().publish(c, { changeNote: "Before the test" });

    const body = (title) => ({
      structure: { on: true, items: [{ id: "w1", on: true }, { id: "w2", on: true }] },
      text_en: { "w1.title": title, "w2.title": `Secret ${STAMP}`, "w9.title": "orphan" },
      text_fr: { "w1.title": "Flotte propre" },
    });
    const [a, b] = await Promise.all([
      service().saveSection(c, { key: "why_us", body: body("Own fleet") }),
      service().saveSection(c2, { key: "why_us", body: body("Own fleet") }),
    ]);
    expect(a.draft.version_id).toBe(b.draft.version_id);
    const drafts = await c.query("SELECT count(*)::int n FROM company_profile_version WHERE status = 'DRAFT'");
    expect(drafts.rows[0].n).toBe(1);
    expect(a.section.text_en["w9.title"]).toBeUndefined();
    expect(a.completeness.why_us).toBe("partial");

    await expect(service().saveSection(c, {
      key: "why_us",
      body: { text_en: { "w1.body": "x".repeat(400) } },
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  let first;
  test("publish supersedes, and a published version is never edited", async () => {
    const previous = await repo().byStatus(c, "PUBLISHED");
    first = await service().publish(c, { changeNote: "First" });
    expect(first.status).toBe("PUBLISHED");
    if (previous) {
      const old = await repo().getVersion(c, previous.version_id);
      expect(old.status).toBe("SUPERSEDED");
    }
    await expect(service().publish(c, {})).rejects.toMatchObject({ code: "NOTHING_TO_PUBLISH" });

    // Round the service: the trigger refuses it.
    await expect(c.query(
      "UPDATE company_profile_section SET text_en = '{}'::jsonb WHERE version_id = $1 AND section_key = 'why_us'",
      [first.version_id],
    )).rejects.toThrow(/never edited/);
    await expect(c.query(
      "UPDATE company_profile_version SET status = 'DRAFT' WHERE version_id = $1",
      [first.version_id],
    )).rejects.toThrow(/only be superseded/);
  });

  test("a share follows the published version; a pinned one does not; opens are counted", async () => {
    const follow = await service().createShare(c, {
      data: { recipient_name: `Follow ${STAMP}`, expires_on: tomorrow(), language: "EN" },
    });
    const pinned = await service().createShare(c, {
      data: { recipient_name: `Pinned ${STAMP}`, expires_on: tomorrow(), pin_version: true },
    });
    expect(follow.path).toMatch(/^\/public\/profile\//);
    expect(pinned.share.pinned_version).toBe(first.number);

    const seen = await pub().open(c, { token: follow.token, ua: "Mozilla/5.0 (iPhone; Mobile)" });
    expect(JSON.stringify(seen.presentation)).toContain(`Secret ${STAMP}`);

    // Hide the promise in a new draft and publish it.
    const next = await service().saveSection(c, {
      key: "why_us",
      body: { structure: { on: true, items: [{ id: "w1", on: true }, { id: "w2", on: false }] } },
    });
    expect(next.draft.number).toBe(first.number + 1);
    await service().publish(c, { changeNote: "Second" });

    const followed = await pub().open(c, { token: follow.token, ua: "Mozilla/5.0 (Windows NT 10.0)" });
    expect(JSON.stringify(followed.presentation)).not.toContain(`Secret ${STAMP}`);
    const stayed = await pub().open(c, { token: pinned.token, ua: "Mozilla/5.0" });
    expect(JSON.stringify(stayed.presentation)).toContain(`Secret ${STAMP}`);

    const { share, opens } = await service().shareOpens(c, { id: follow.share.share_id });
    expect(share.open_count).toBe(2);
    expect(opens.map((o) => o.agent_label)).toEqual(["Desktop browser", "Mobile browser"]);
    const stamps = await c.query("SELECT first_opened_at, last_opened_at FROM company_profile_share WHERE share_id = $1", [follow.share.share_id]);
    expect(stamps.rows[0].first_opened_at < stamps.rows[0].last_opened_at).toBe(true);

    const diff = await service().diff(c, { versionId: (await repo().byStatus(c, "PUBLISHED")).version_id });
    expect(diff.changes).toEqual(expect.arrayContaining([expect.objectContaining({ section_key: "why_us", field: "items" })]));
  });

  test("revoked and expired links answer 404, and nothing in the token is stored", async () => {
    const s = await service().createShare(c, { data: { recipient_email: `r.${STAMP}@example.org`, expires_on: tomorrow() } });
    const stored = await c.query("SELECT token_hash FROM company_profile_share WHERE share_id = $1", [s.share.share_id]);
    expect(stored.rows[0].token_hash).not.toContain(s.token);

    await service().revokeShare(c, { id: s.share.share_id });
    await expect(pub().open(c, { token: s.token })).rejects.toMatchObject({ status: 404 });
    await expect(service().revokeShare(c, { id: s.share.share_id })).rejects.toMatchObject({ code: "ALREADY_REVOKED" });

    const e = await service().createShare(c, { data: { recipient_name: `Expired ${STAMP}`, expires_on: tomorrow() } });
    await c.query("UPDATE company_profile_share SET expires_at = now() - interval '1 minute' WHERE share_id = $1", [e.share.share_id]);
    await expect(pub().open(c, { token: e.token })).rejects.toMatchObject({ status: 404 });
    await expect(pub().open(c, { token: "not-a-real-token" })).rejects.toMatchObject({ status: 404 });
  });

  test("the AI reads the published version only", async () => {
    await service().saveSection(c, { key: "cover", body: { text_en: { tagline: `Draft only ${STAMP}` } } });
    const ai = await service().published(c);
    expect(ai.published).toBe(true);
    expect(JSON.stringify(ai.profile)).not.toContain(`Draft only ${STAMP}`);
  });
});
