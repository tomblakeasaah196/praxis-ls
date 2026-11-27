"use strict";

/**
 * The mail image proxy (remote-image.service.js).
 *
 * The rule worth pinning is the one that keeps it from being an open proxy: a
 * URL is fetched only when the stored body of THIS message references it as an
 * image. The rest are the serving rules: raster only, never SVG, never a
 * truncated body, and never anything but absolute http(s).
 */

const path = require("path");
const { execFileSync } = require("child_process");
const images = require("../../src/modules/mail/mail/remote-image.service");

const MAIL = path.join(__dirname, "..", "..", "src", "modules", "mail", "mail");

/**
 * The references a body makes, computed in a plain Node process.
 *
 * sanitize-html depends on an ESM-only htmlparser2 that Jest's CommonJS runtime
 * cannot load (the header of mail-body-html.test.js has the story), and the
 * whole point of these cases is the REAL parser's reading of the markup. With
 * `clean`, the body first goes through the ingest sanitizer, as a stored one has.
 */
function refs(inputs, { clean = false } = {}) {
  const script = `
    const { remoteRefs } = require(${JSON.stringify(path.join(MAIL, "remote-image.service.js"))});
    const { cleanHtml } = require(${JSON.stringify(path.join(MAIL, "body-html.js"))});
    const inputs = JSON.parse(require("fs").readFileSync(0, "utf8"));
    process.stdout.write(JSON.stringify(inputs.map((h) => [...remoteRefs(${clean ? "cleanHtml(h)" : "h"})].sort())));
  `;
  return JSON.parse(execFileSync(process.execPath, ["-e", script], { input: JSON.stringify(inputs), encoding: "utf8" }));
}

/** The fetch rules run without the parser: a body is the set of URLs it references. */
const refsOf = (html) => new Set(String(html || "").split(" ").filter(Boolean));

const LOGO = "https://nfelia.com/assets/img/nfelia-mark-email.png";

const client = (bodyHtml) => ({
  query: jest.fn(async () => ({ rows: bodyHtml === undefined ? [] : [{ body_html: bodyHtml }] })),
});

const png = (extra = {}) => jest.fn(async () => ({
  ok: true, status: 200, contentType: "image/png", body: Buffer.from("PNGBYTES"), truncated: false,
  headers: {}, finalUrl: LOGO, ...extra,
}));

describe("remoteRefs: the image references a stored body makes", () => {
  test("src, srcset, poster, background and CSS url() are all found, entity-decoded like the DOM reads them", () => {
    const html = [
      "<style>.h{background:url('https://a.example/sheet.png')}</style>",
      "<div style=\"background-image:url(&quot;https://a.example/inline.png?a=1&amp;b=2&quot;)\">",
      "<img src=\"https://a.example/logo.png?a=1&amp;b=2\">",
      "<img srcset=\"https://cdn.example/w_600,h_400/a.jpg 1x, https://cdn.example/b.jpg 2x\">",
      "<video poster=\"https://a.example/poster.jpg\"></video>",
      "<table><tr><td background=\"http://old.example/tile.gif\"></td></tr></table>",
      "</div>",
    ].join("");
    expect(refs([html])[0]).toEqual([
      "http://old.example/tile.gif",
      "https://a.example/inline.png?a=1&b=2",
      "https://a.example/logo.png?a=1&b=2",
      "https://a.example/poster.jpg",
      "https://a.example/sheet.png",
      // A comma inside a CDN URL is part of the URL, not a candidate separator.
      "https://cdn.example/b.jpg",
      "https://cdn.example/w_600,h_400/a.jpg",
    ]);
  });

  test("cid:, data:, blob: and relative references are not remote", () => {
    const html = "<img src=\"cid:logo@x\"><img src=\"data:image/png;base64,AAAA\"><img src=\"blob:x\"><img src=\"/media/a.png\">";
    expect(refs([html])[0]).toEqual([]);
  });

  test("a protocol-relative reference is the https one", () => {
    expect(refs(["<img src=\"//cdn.example/a.png\">"])[0]).toEqual(["https://cdn.example/a.png"]);
  });

  test("a body as the ingest sanitizer stores it still yields the sender's logo", () => {
    const [found] = refs(
      [`<html><body style="margin:0"><table><tr><td><img src="${LOGO}" width="55" height="40" alt=""></td></tr></table></body></html>`],
      { clean: true },
    );
    expect(found).toEqual([LOGO]);
  });
});

describe("imageFor: what the proxy will fetch", () => {
  test("a URL the message references is fetched through the guard, as an image, and served", async () => {
    const fetchImpl = png();
    const out = await images.imageFor(client(LOGO), "m1", LOGO, { fetchImpl, refsOf });
    expect(out).toEqual({ contentType: "image/png", buffer: Buffer.from("PNGBYTES") });
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe(LOGO);
    expect(opts.maxBytes).toBe(images.MAX_BYTES);
    expect(opts.allowContentTypes).toEqual(expect.arrayContaining(["image/png", "image/jpeg", "image/gif"]));
    expect(opts.allowContentTypes.some((t) => /svg/.test(t))).toBe(false);
    expect(opts.userAgent).toMatch(/mail image proxy/);
  });

  test("a URL the message does NOT reference is never fetched: this is not an open proxy", async () => {
    const fetchImpl = png();
    for (const other of ["https://169.254.169.254/latest/meta-data/", "https://elsewhere.example/a.png", `${LOGO}?x`]) {
      await expect(images.imageFor(client(LOGO), "m1", other, { fetchImpl, refsOf })).resolves.toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("a message that is not there is null, with no fetch", async () => {
    const fetchImpl = png();
    await expect(images.imageFor(client(undefined), "gone", LOGO, { fetchImpl, refsOf })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("anything but absolute http(s) is refused before the database is asked", async () => {
    const c = client(LOGO);
    for (const bad of [null, "", "cid:logo", "data:image/png;base64,AA", "/media/a.png", "javascript:alert(1)", `https://a.example/${"x".repeat(3000)}`]) {
      await expect(images.imageFor(c, "m1", bad, { fetchImpl: png(), refsOf })).resolves.toBeNull();
    }
    expect(c.query).not.toHaveBeenCalled();
  });

  test("a protocol-relative reference is matched and fetched over https", async () => {
    const fetchImpl = png();
    await images.imageFor(client("https://cdn.example/a.png"), "m1", "//cdn.example/a.png", { fetchImpl, refsOf });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://cdn.example/a.png");
  });

  test("an SVG is refused even when the transport let it through: these bytes leave from our origin", async () => {
    const fetchImpl = png({ contentType: "image/svg+xml" });
    await expect(images.imageFor(client(LOGO), "m1", LOGO, { fetchImpl, refsOf })).resolves.toBeNull();
  });

  test("a non-image answer, a refusal and a truncated body are all null", async () => {
    const body = LOGO;
    const cases = [
      png({ contentType: "text/html" }),
      png({ truncated: true }),
      png({ body: Buffer.alloc(0) }),
      jest.fn(async () => ({ ok: false, reason: "private-resolver" })),
      jest.fn(async () => ({ ok: false, reason: "status", status: 404 })),
    ];
    for (const fetchImpl of cases) {
      await expect(images.imageFor(client(body), "m1", LOGO, { fetchImpl, refsOf })).resolves.toBeNull();
    }
  });
});
