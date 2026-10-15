"use strict";

/**
 * The inbound body policy, proven against the REAL sanitize-html.
 *
 * ── WHY A CHILD PROCESS ─────────────────────────────────────────────────────
 *
 * sanitize-html depends on an ESM-only htmlparser2 that Jest's CommonJS
 * runtime cannot load (see the header of mail-compose.test.js). Everywhere else
 * that is handled by stubbing the library and asserting only that a fragment is
 * ROUTED through it. That is not good enough here: this file exists because
 * the routing was always fine and the POLICY flattened every email anyone
 * received. A stub would pass for the old policy and the new one alike.
 *
 * So each case runs `cleanHtml` in a plain Node process, which loads the real
 * library exactly as the ingest path does in production, and hands the output
 * back as JSON.
 */
const path = require("path");
const { execFileSync } = require("child_process");

const MODULE = path.join(__dirname, "..", "..", "src", "modules", "mail", "mail", "body-html.js");

/** Run `cleanHtml` (or `cleanCss`) on each input in a real Node runtime. */
function run(fn, inputs) {
  // Inputs on stdin rather than argv: one argument is capped at 128 KB by the
  // kernel, and the hostile-input cases below are larger than that on purpose.
  const script = `
    const m = require(${JSON.stringify(MODULE)});
    const inputs = JSON.parse(require("fs").readFileSync(0, "utf8"));
    process.stdout.write(JSON.stringify(inputs.map((x) => m[${JSON.stringify(fn)}](x))));
  `;
  return JSON.parse(execFileSync(process.execPath, ["-e", script], { input: JSON.stringify(inputs), encoding: "utf8" }));
}

/** The shape of the message that started this: a branded header, laid out in a table. */
const BRANDED = `<html><head><title>Demo build brief</title><meta charset="utf-8">
<style>.hd{color:#c9a227;letter-spacing:4px}</style></head>
<body style="margin:0;background-color:#f4f1ea" bgcolor="#f4f1ea">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#0b3d2e">
<tr><td class="hd" align="center" style="font-family:Georgia,serif;padding:24px">DEMO BUILD BRIEF</td></tr>
</table>
<p style="color:#1f2937;font-size:15px">Hello, <font color="#c9a227" face="Georgia">Lola</font></p>
<center>Beautiful Fabrics</center>
</body></html>`;

describe("cleanHtml keeps what the sender designed", () => {
  const [out] = run("cleanHtml", [BRANDED]);

  test("inline styles survive, on every element that carries one", () => {
    expect(out).toContain('style="background-color:#0b3d2e"');
    expect(out).toContain("font-family:Georgia,serif;padding:24px");
    expect(out).toContain("color:#1f2937;font-size:15px");
  });

  test("the table attributes mail is laid out with survive", () => {
    expect(out).toMatch(/<table[^>]*width="600"/);
    expect(out).toMatch(/<table[^>]*cellpadding="0"/);
    expect(out).toMatch(/<td[^>]*align="center"/);
  });

  test("<font>, <center> and classes survive", () => {
    expect(out).toContain('<font color="#c9a227" face="Georgia">Lola</font>');
    expect(out).toContain("<center>Beautiful Fabrics</center>");
    expect(out).toContain('class="hd"');
  });

  test("a <style> block survives, moved to the front", () => {
    expect(out.startsWith("<style>.hd{color:#c9a227;letter-spacing:4px}</style>")).toBe(true);
  });

  test("the body's own background moves onto a wrapper instead of being lost", () => {
    expect(out).toMatch(/<div style="margin:0;background-color:#f4f1ea" bgcolor="#f4f1ea" data-email-body>/);
  });

  test("the <title> text does not surface as words at the top of the body", () => {
    expect(out).not.toContain("Demo build brief");
  });
});

describe("cleanHtml still removes everything that runs or fetches unasked", () => {
  const cases = run("cleanHtml", [
    '<p onclick="steal()">a</p><script>steal()</script>',
    '<a href="javascript:steal()">x</a><a href="https://ok.example" target="_top">y</a>',
    '<form action="https://x"><input name="p"></form><iframe src="https://x"></iframe><p>t</p>',
    '<p>t</p><object data="x"></object><embed src="x"><meta http-equiv="refresh" content="0;url=https://x"><link rel="stylesheet" href="https://x/a.css"><base href="https://x/">',
    "<xml><o:OfficeDocumentSettings>96</o:OfficeDocumentSettings></xml><p>body</p>",
    "<style>@import url(https://track.example/a.css); p{color:red}</style><p>t</p>",
    '<p style="width:expression(alert(1));color:red">t</p>',
    '<p style="background:url(javascript:alert(1))">t</p>',
    "<style>p{content:'</style><script>x()</script>'}</style><p>t</p>",
  ]);

  test("script and event handlers", () => {
    expect(cases[0]).toBe("<p>a</p>");
  });

  test("a script URL loses its href; every link opens a new tab and sends no referrer", () => {
    expect(cases[1]).not.toContain("javascript:");
    expect(cases[1]).toContain('href="https://ok.example" target="_blank" rel="noopener noreferrer"');
    expect(cases[1]).not.toContain("_top");
  });

  test("forms and frames", () => {
    expect(cases[2]).toBe("<p>t</p>");
  });

  test("object, embed, meta, link and base", () => {
    expect(cases[3]).toBe("<p>t</p>");
  });

  test("an Outlook <xml> island leaves no stray text behind", () => {
    expect(cases[4]).toBe("<p>body</p>");
  });

  test("@import goes; the rest of the sheet stays", () => {
    expect(cases[5]).toBe("<style>p{color:red}</style><p>t</p>");
  });

  test("expression() is defused", () => {
    expect(cases[6]).not.toMatch(/expression\s*\(/i);
    expect(cases[6]).toContain("color:red");
  });

  test("a script scheme inside url() is defused", () => {
    expect(cases[7]).not.toContain("javascript:");
  });

  test("CSS cannot close its own <style> element", () => {
    // The parser ends the first block at the first `</style`; whatever follows
    // is markup again, and the script in it is removed like any other.
    expect(cases[8]).not.toContain("<script");
    expect((cases[8].match(/<\/style>/g) || []).length).toBe(1);
  });
});

describe("cleanHtml: images are KEPT, because blocking them is a render-time choice", () => {
  const [out] = run("cleanHtml", [
    '<img src="cid:logo@x"><img src="data:image/png;base64,AAA"><img src="https://track.example/p.gif"><img src="javascript:x">',
  ]);

  test("cid:, data: and https images all survive ingest", () => {
    expect(out).toContain('src="cid:logo@x"');
    expect(out).toContain('src="data:image/png;base64,AAA"');
    // Stored, then held back by the reading pane until somebody asks (§5.6.3).
    expect(out).toContain('src="https://track.example/p.gif"');
  });

  test("a script scheme on an image does not", () => {
    expect(out).not.toContain("javascript:");
  });
});

describe("cleanHtml: an empty result is stored as null", () => {
  test("a body that cleans down to nothing visible", () => {
    const [empty, image, text] = run("cleanHtml", [
      "<html><head><title>t</title><style>p{}</style></head><body> </body></html>",
      "<p><img src='cid:a'></p>",
      "<p>hi</p>",
    ]);
    expect(empty).toBeNull();
    expect(image).toContain("cid:a");
    expect(text).toBe("<p>hi</p>");
  });
});

describe("cleanCss: Outlook's stylesheet keeps its first rule", () => {
  // Outlook wraps every <style> in <!-- -->. Escaped rather than removed, the
  // opener became the start of the first selector, and `p.MsoNormal` (the
  // paragraph style of every Outlook message) was dropped as invalid.
  const [out] = run("cleanCss", ["<!--\np.MsoNormal{margin:0}\n-->"]);

  test("the comment markers go and the rule is untouched", () => {
    expect(out).toBe("p.MsoNormal{margin:0}");
  });

  test("a stray < is still escaped", () => {
    const [esc] = run("cleanCss", ["a{content:'<'}"]);
    expect(esc).toContain("\\3c ");
  });
});

describe("cleanCss stays linear on hostile input", () => {
  test("unterminated comments and long whitespace runs", () => {
    const t0 = Date.now();
    run("cleanCss", ["/*".repeat(100000), `url(${" ".repeat(100000)}`, `${"a".repeat(100000)}:`]);
    // Generous: the point is that it does not take minutes, not a benchmark.
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
