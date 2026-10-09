"use strict";

/**
 * The verification link a document carries — doc/SIGNATURE_ENGINEERING_GUIDE.md
 * §3.7, §5.2.
 *
 * The QR's density budget is the reason several of these are pinned as numbers
 * rather than described in prose. §3.7 measured it: a phone camera wants ≥
 * 0.5mm per module at arm's length and 300dpi print needs ≥ 0.34mm. In the
 * 22mm the seal allocates, a 33-module symbol gives 0.67mm and a 45-module one
 * gives 0.49 — right on the phone threshold, before a photocopier touches it.
 *
 * A change that lengthens the URL degrades a printed artefact that cannot be
 * re-issued, so the module count is a test and not a comment.
 */

const qr = require("../../src/services/signatures/qr");
const tokens = require("../../src/services/signatures/tokens");
const verifyLink = require("../../src/services/signatures/verify-link");

describe("the URL the QR encodes", () => {
  test("it is /v/<code> on the host the caller names", async () => {
    const ctx = await verifyLink.verifyContext(null, { code: "A4B7K92MXQ1P", slug: "smartls" });
    expect(ctx.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P");
  });

  test("a code a human typed with separators and lower case still resolves", async () => {
    // The code is read down phone lines and copied off paper. Crockford's
    // substitutions and any separator the reader felt like using are accepted.
    const ctx = await verifyLink.verifyContext(null, { code: " a4b7-k92m-xq1p ", slug: "smartls" });
    expect(ctx.code).toBe("A4B7K92MXQ1P");
    expect(ctx.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P");
  });

  test("an explicit origin wins over a slug — a tenant that moved host", async () => {
    const ctx = await verifyLink.verifyContext(null, {
      code: "A4B7K92MXQ1P", slug: "smartls", origin: "https://docs.smartlogistics.cm",
    });
    expect(ctx.url).toBe("https://docs.smartlogistics.cm/v/A4B7K92MXQ1P");
  });

  test("a trailing slash on the origin does not double up", async () => {
    const ctx = await verifyLink.verifyContext(null, { code: "A4B7K92MXQ1P", origin: "https://x.cm///" });
    expect(ctx.url).toBe("https://x.cm/v/A4B7K92MXQ1P");
  });

  test("a bare host is given a scheme rather than producing a relative URL", async () => {
    const ctx = await verifyLink.verifyContext(null, { code: "A4B7K92MXQ1P", origin: "x.praxisls.com" });
    expect(ctx.url).toBe("https://x.praxisls.com/v/A4B7K92MXQ1P");
  });

  test("no code means no block — a QR resolving to /v/ is worse than none", async () => {
    expect(await verifyLink.verifyContext(null, { code: "", slug: "smartls" })).toBeNull();
    expect(await verifyLink.verifyContext(null, { code: null, slug: "smartls" })).toBeNull();
  });

  test("the tenant setting is consulted only when the caller has no host", async () => {
    const client = {
      query: async (sql) => (/FROM setting/.test(sql)
        ? { rows: [{ value: "https://verify.smartlogistics.cm" }] }
        : { rows: [] }),
    };
    const fromSetting = await verifyLink.verifyContext(client, { code: "A4B7K92MXQ1P" });
    expect(fromSetting.url).toBe("https://verify.smartlogistics.cm/v/A4B7K92MXQ1P");

    const fromCaller = await verifyLink.verifyContext(client, { code: "A4B7K92MXQ1P", slug: "smartls" });
    expect(fromCaller.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P");
  });

  test("a sandbox-signed code carries ?e=sandbox — live URLs stay bare", async () => {
    // The env is baked into the printed URL, not sent as a client header, so a
    // stranger scanning a test-environment document lands on a page that pins
    // its own database read to sandbox rather than 404ing against live. A
    // live URL is unchanged so nothing prints differently for real documents.
    const live = await verifyLink.verifyContext(null, { code: "A4B7K92MXQ1P", slug: "smartls", env: "live" });
    expect(live.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P");
    const sandbox = await verifyLink.verifyContext(null, { code: "A4B7K92MXQ1P", slug: "smartls", env: "sandbox" });
    expect(sandbox.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P?e=sandbox");
  });
});

/**
 * Rung 1 of the host chain: the tenant's own public website.
 *
 * ── WHY THIS IS A TEST AND NOT A COMMENT ──────────────────────────────────
 *
 * The QR is printed on paper that cannot be re-issued. Before this rung
 * existed every code resolved on the STAFF workspace host, which put a tenant's
 * internal ERP hostname on their customer's invoice — and, for a tenant serving
 * their own domain, pointed at a host where `/v/` is not served at all
 * (src/server.js mounts public-web at the root of a `surface='public'` host and
 * the ERP not at all). A regression here is invisible until somebody scans a
 * document at a border post.
 *
 * `registry.service` is mocked rather than stood up: `verify-link` requires it
 * lazily by design (the cycle note in `publicSiteOrigin`), so the mock is what
 * that deferred require resolves to.
 */
describe("the host the QR resolves on", () => {
  const registry = require("../../src/services/tenant/registry.service");

  /** A tenant connection carrying the id `registry.tenantIdOf` reads. */
  const clientFor = (tenantId) => {
    const c = { query: async () => ({ rows: [] }) };
    c[registry.TENANT_ID] = tenantId;
    return c;
  };

  afterEach(() => jest.restoreAllMocks());

  test("the tenant's own public website wins over the workspace host", async () => {
    jest.spyOn(registry, "publicSurfaceOrigin").mockResolvedValue("https://staging.smartls.cm");
    const ctx = await verifyLink.verifyContext(clientFor("t-1"), {
      code: "A4B7K92MXQ1P", slug: "smartls", origin: "https://smartls.praxisls.com",
    });
    // NOT smartls.praxisls.com, although the caller named it: a stranger's
    // verification belongs on the surface the tenant publishes to strangers.
    expect(ctx.url).toBe("https://staging.smartls.cm/v/A4B7K92MXQ1P");
  });

  test("a tenant with no public website keeps today's workspace host", async () => {
    jest.spyOn(registry, "publicSurfaceOrigin").mockResolvedValue(null);
    const ctx = await verifyLink.verifyContext(clientFor("t-2"), {
      code: "A4B7K92MXQ1P", slug: "smartls", origin: "https://smartls.praxisls.com",
    });
    // The ERP still answers /v/ there, which is why this fallback is kept
    // rather than the public domain being made a requirement for signing.
    expect(ctx.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P");
  });

  test("a registry failure degrades the host — it never fails the render", async () => {
    // A document that does not exist is strictly worse than one whose QR points
    // at the workspace host, so the lookup swallows and falls through.
    jest.spyOn(registry, "publicSurfaceOrigin").mockRejectedValue(new Error("platform db down"));
    const ctx = await verifyLink.verifyContext(clientFor("t-3"), {
      code: "A4B7K92MXQ1P", slug: "smartls", origin: "https://smartls.praxisls.com",
    });
    expect(ctx.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P");
  });

  test("a connection with no tenant id never reaches the registry", async () => {
    // The mocked clients the rest of this file uses are this shape, and a
    // lookup on `undefined` would be a query per render for nothing.
    const spy = jest.spyOn(registry, "publicSurfaceOrigin");
    const ctx = await verifyLink.verifyContext({ query: async () => ({ rows: [] }) }, {
      code: "A4B7K92MXQ1P", slug: "smartls",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(ctx.url).toBe("https://smartls.praxisls.com/v/A4B7K92MXQ1P");
  });

  test("the public host is used as-is — no /public prefix on a printed path", async () => {
    // `publicSiteBaseUrl` next door appends `/public` on a workspace host; this
    // chain must not, because the path length is the QR's density budget
    // (§3.7). Pinned so a later "simplification" to the neighbouring function
    // fails here rather than in a warehouse.
    jest.spyOn(registry, "publicSurfaceOrigin").mockResolvedValue("https://staging.smartls.cm");
    const ctx = await verifyLink.verifyContext(clientFor("t-4"), { code: "A4B7K92MXQ1P" });
    expect(ctx.url).not.toContain("/public");
    expect(ctx.url).toBe("https://staging.smartls.cm/v/A4B7K92MXQ1P");
  });
});

describe("the symbol itself", () => {
  const url = "https://smartls.praxisls.com/v/A4B7K92MXQ1P";

  test("§3.7 — the short code on the short path stays inside 33 modules", async () => {
    // Asserted on MODULES and millimetres, not on character count: the guide's
    // table quotes 40 characters for a short tenant host and a real one runs to
    // 43, but both land in the same QR version. The character count is a proxy;
    // the module pitch is the thing a phone camera actually sees.
    const modules = await qr.moduleCount(url);
    expect(modules).toBeLessThanOrEqual(33);
    // 22mm / 33 modules = 0.67mm — a third clear of the 0.5mm a phone wants at
    // arm's length, and double the 0.34mm 300dpi print needs.
    expect(22 / modules).toBeGreaterThan(0.6);
  });

  test("the seal's 22mm budget survives the longest realistic tenant host", async () => {
    // A tenant slug is bounded by its subdomain, so this is close to the worst
    // case the fleet can produce. If it ever stops fitting, the answer is the
    // dedicated short host §3.7 measured — not a smaller symbol.
    const worst = `https://a-fairly-long-tenant-slug.praxisls.com/v/A4B7K92MXQ1P`;
    expect(22 / (await qr.moduleCount(worst))).toBeGreaterThan(0.5);
  });

  test("the sandbox variant survives the same 22mm budget", async () => {
    // A sandbox-signed document adds `?e=sandbox` (10 chars). Measured on the
    // same worst-case host: 41 modules, 0.537 mm/module at 22mm — above the
    // 0.5mm phone-camera threshold in §3.7. A regression that pushes it past
    // one more QR version cliff would silently make test documents unscannable
    // in warehouse light, so it is a test.
    const worst = `https://a-fairly-long-tenant-slug.praxisls.com/v/A4B7K92MXQ1P?e=sandbox`;
    expect(22 / (await qr.moduleCount(worst))).toBeGreaterThan(0.5);
  });

  test("the long path this replaced would have cost a QR version", async () => {
    // Kept as a live comparison rather than a comment, so the claim in §3.7
    // stays true of the library actually installed.
    const long = "https://smartls.praxisls.com/public/verify/A4B7K92MXQ1P";
    expect(await qr.moduleCount(long)).toBeGreaterThan(await qr.moduleCount(url));
  });

  test("it is inline SVG sized in millimetres, not a data-URI image", async () => {
    const ctx = await verifyLink.verifyContext(null, { code: "A4B7K92MXQ1P", slug: "smartls", sizeMm: 22 });
    expect(ctx.qrSvg.startsWith("<svg")).toBe(true);
    expect(ctx.qrSvg).toContain('width="22mm"');
    expect(ctx.qrSvg).toContain('height="22mm"');
    // Puppeteer rasterises inline SVG at print resolution; a data-URI <img>
    // would be resampled from a bitmap and needs the renderer's CSP to allow it.
    expect(ctx.qrSvg).not.toContain("data:image");
  });

  test("error correction stays at Q — this gets photocopied and faxed", async () => {
    // Level Q tolerates ~25% damage against M's ~15%. Asserted by outcome: the
    // same payload at level M needs fewer modules, so a regression to M shows
    // up as a smaller symbol.
    const QRCode = require("qrcode");
    const atM = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 0 });
    const mModules = Number(atM.match(/viewBox="0 0 (\d+)/)[1]);
    expect(await qr.moduleCount(url)).toBeGreaterThan(mModules);
  });
});

describe("the printed code", () => {
  test("it is grouped in fours for someone reading it aloud", () => {
    expect(tokens.formatCode("A4B7K92MXQ1P")).toBe("A4B7-K92M-XQ1P");
  });

  test("grouping is display-only and never stored", () => {
    expect(tokens.normaliseCode("A4B7-K92M-XQ1P")).toBe("A4B7K92MXQ1P");
  });

  test("the alphabet excludes the characters that misread in 5pt type", () => {
    for (const ch of ["I", "L", "O", "U"]) expect(tokens.ALPHABET).not.toContain(ch);
  });
});
