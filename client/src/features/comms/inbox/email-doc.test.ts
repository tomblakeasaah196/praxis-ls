/**
 * The sealed frame's document: what it is allowed, asserted without mounting.
 */
import { describe, expect, it } from "vitest";
import { buildSrcDoc, parseMailto } from "./email-doc";

const INK = { fg: "rgb(1, 2, 3)", link: "rgb(4, 5, 6)", rule: "rgb(7, 8, 9)", font: "Inter, system-ui" };
const cspOf = (doc: string) => /Content-Security-Policy" content="([^"]*)"/.exec(doc)?.[1] || "";

describe("buildSrcDoc", () => {
  it("allows no script, no frames and no forms, ever", () => {
    const csp = cspOf(buildSrcDoc("<p>x</p>", { showRemote: true, ink: INK, scheme: "light" }));
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/script-src/);
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  it("fetches remote images only once they are allowed", () => {
    expect(cspOf(buildSrcDoc("", { showRemote: false, ink: INK, scheme: "light" }))).toContain("img-src data: blob:;");
    expect(cspOf(buildSrcDoc("", { showRemote: true, ink: INK, scheme: "light" }))).toContain("img-src data: blob: https:;");
  });

  it("sends every link to a new tab and draws with the tenant's ink", () => {
    const doc = buildSrcDoc("<p>x</p>", { showRemote: false, ink: INK, scheme: "dark" });
    expect(doc).toContain('<base target="_blank">');
    expect(doc).toContain("color:rgb(1, 2, 3)");
    expect(doc).toContain("a{color:rgb(4, 5, 6)}");
    expect(doc).toContain("color-scheme:dark");
    expect(doc).toContain('<div id="pxm"><p>x</p></div>');
  });
});

describe("parseMailto", () => {
  it("reads recipients, copies, subject and body", () => {
    expect(parseMailto("mailto:lola@beautiful-fabrics.com,innocent@beautiful-fabrics.com?cc=a%40b.cm&subject=Demo%20brief&body=Hi")).toEqual({
      to: ["lola@beautiful-fabrics.com", "innocent@beautiful-fabrics.com"],
      cc: ["a@b.cm"],
      subject: "Demo brief",
      body: "Hi",
    });
  });

  it("a malformed escape is read as written, not thrown", () => {
    expect(parseMailto("mailto:a%ZZ@b.cm").to).toEqual(["a%ZZ@b.cm"]);
  });
});
