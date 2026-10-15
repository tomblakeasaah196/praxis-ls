/**
 * The two reading-pane rules from §5.6.3, tested where they are decidable.
 *
 * Both are pure string transforms on already-sanitized markup, so they are
 * testable without a renderer — which is the reason they live in their own
 * module rather than inside the component that draws them.
 */
import { describe, expect, it } from "vitest";
import {
  blockRemoteContent,
  restoreRemoteContent,
  splitQuotedHtml,
  splitQuotedText,
} from "./message-body";

describe("remote content", () => {
  it("holds back an http(s) image and keeps the address for later", () => {
    const out = blockRemoteContent('<p>hi</p><img src="https://track.example/p.gif" alt="">');
    expect(out.blocked).toBe(1);
    // The leading space matters: `data-blocked-src="…"` trivially contains the
    // substring `src="…"`, and asserting on the bare substring would pass for
    // a version of this that had done nothing.
    expect(out.html).not.toContain(' src="https://track.example/p.gif"');
    expect(out.html).toContain('data-blocked-src="https://track.example/p.gif"');
    expect(restoreRemoteContent(out.html)).toContain('src="https://track.example/p.gif"');
  });

  it("leaves cid: and data: alone — neither reaches a third party", () => {
    const html = '<img src="cid:logo@praxis"><img src=\'data:image/png;base64,AAA\'>';
    const out = blockRemoteContent(html);
    expect(out.blocked).toBe(0);
    // Asserted semantically, not byte-for-byte: the body goes through the
    // browser's parser now, which normalises `'` to `"` on the way out. What
    // matters is that both `src` attributes SURVIVE — a byte-exact assertion
    // here would fail on a re-quote while passing on a dropped attribute.
    expect(out.html).toContain('src="cid:logo@praxis"');
    expect(out.html).toContain('src="data:image/png;base64,AAA"');
    expect(out.html).not.toContain("data-blocked");
  });

  it("CATCHES AN UNQUOTED SRC — the hole the regex version had", () => {
    // `<img src=https://track.example/p.gif>` is valid HTML that needs no
    // quotes, and the pattern this replaced required them. Every unquoted
    // pixel went straight through the control whose job is to stop pixels.
    const out = blockRemoteContent("<p>hi</p><img src=https://track.example/p.gif>");
    expect(out.blocked).toBe(1);
    expect(out.html).toContain('data-blocked-src="https://track.example/p.gif"');
  });

  it("KEEPS TABLE CELLS, which mail HTML is made of", () => {
    // Body-context parsing silently discards a `<td>` with no table ancestor,
    // and this function's output is what the reading pane renders — so that
    // would drop content out of a table-based message. Template context keeps
    // it. (Our own compose.js emits a table layout.)
    const out = blockRemoteContent('<td style="background:url(https://x.example/bg.png)">cell</td>');
    expect(out.html).toContain("<td");
    expect(out.html).toContain("cell");
    expect(out.blocked).toBe(1);
  });

  it("catches the background image people forget", () => {
    const out = blockRemoteContent('<table><tr><td style="background:url(https://x.example/bg.png)">a</td></tr></table>');
    expect(out.blocked).toBe(1);
    expect(out.html).toContain("background:none");
  });

  it("leaves a local background image alone", () => {
    const out = blockRemoteContent('<div style="background:url(cid:bg@praxis)">a</div>');
    expect(out.blocked).toBe(0);
    expect(out.html).toContain("cid:bg@praxis");
  });

  it("catches srcset and poster too", () => {
    const out = blockRemoteContent(
      '<img srcset="https://a.example/1.png 1x"><video poster="https://a.example/p.jpg"></video>',
    );
    expect(out.blocked).toBe(2);
  });

  /*
   * `srcset` is the one attribute here holding MORE THAN ONE url, and the two
   * obvious ways to split it are each wrong in a different direction. These
   * four shapes are the ones that decide it — the first two were both bugs.
   */
  describe("srcset, which is a candidate list", () => {
    const srcset = (v: string) => blockRemoteContent(`<img srcset="${v}">`);

    it("READS EVERY CANDIDATE, not just the first", () => {
      // Testing the value as one URL asks only about the first entry, so a
      // list starting `cid:` let every remote entry after it through — and a
      // retina screen picks the 2x one.
      const out = srcset("cid:logo@x 1x, https://track.example/p.gif 2x");
      expect(out.blocked).toBe(1);
      expect(out.html).not.toContain(" srcset=");
      expect(restoreRemoteContent(out.html)).toContain("https://track.example/p.gif 2x");
    });

    it("DOES NOT SPLIT A data: URI ON ITS OWN COMMA", () => {
      // Every base64 data URI contains one. Splitting on commas leaves `AAAB`,
      // which has no local scheme and so reads as remote — blocking an inline
      // logo behind "Show images" for no reason.
      const out = srcset("data:image/png;base64,AAAB 1x");
      expect(out.blocked).toBe(0);
      expect(out.html).toContain("srcset=");
    });

    it("still splits a comma-only list, which has no spaces to split on", () => {
      // `url1,url2` is a valid two-candidate list with no descriptors. Relying
      // on whitespace alone would test it as a single URL — and this is the
      // dangerous direction, because a leading cid: would mask the https:.
      const out = srcset("cid:logo@x,https://track.example/p.gif");
      expect(out.blocked).toBe(1);
    });

    it("does not mistake a descriptor for a URL", () => {
      // `1x,cid:b@x` arrives as one whitespace token holding both.
      const out = srcset("cid:a@x 1x,cid:b@x 2x");
      expect(out.blocked).toBe(0);
    });

    it("leaves an all-local srcset alone", () => {
      const out = srcset("cid:a@x 1x, cid:b@x 2x");
      expect(out.blocked).toBe(0);
      expect(out.html).toContain("srcset=");
    });
  });
});

describe("quoted history", () => {
  it("folds at the first blockquote", () => {
    const { visible, quoted } = splitQuotedHtml("<p>My answer.</p><blockquote><p>Yours</p></blockquote>");
    expect(visible).toBe("<p>My answer.</p>");
    expect(quoted).toContain("Yours");
  });

  it("does not fold a forward whose whole body is the quotation", () => {
    const html = "<blockquote><p>the forwarded thing</p></blockquote>";
    expect(splitQuotedHtml(html)).toEqual({ visible: html, quoted: null });
  });

  it("folds on the English attribution when there is no blockquote", () => {
    const html = "<div>Noted, thanks.</div><div>On 12 Feb 2026, Ada wrote:</div><div>original</div>";
    const { visible, quoted } = splitQuotedHtml(html);
    expect(visible).toContain("Noted, thanks.");
    expect(quoted).toContain("original");
  });

  it("folds on the French attribution, non-breaking space and all", () => {
    const text = "Bien reçu.\n\nLe 12 février 2026, Ada a écrit :\n> l'original";
    const { visible, quoted } = splitQuotedText(text);
    expect(visible).toBe("Bien reçu.");
    expect(quoted).toContain("l'original");
  });

  it("folds a trailing run of > lines", () => {
    const { visible, quoted } = splitQuotedText("Yes.\n\n> the question\n> continued");
    expect(visible).toBe("Yes.");
    expect(quoted).toContain("> the question");
  });

  it("leaves an interleaved reply alone", () => {
    // A `>` run that does NOT reach the end is somebody answering point by
    // point. Folding from the first `>` would hide half of what they wrote.
    const text = "> your first point\nAgreed.\n\n> your second\nNot this one.";
    expect(splitQuotedText(text).quoted).toBeNull();
  });

  it("leaves a message with no history alone", () => {
    expect(splitQuotedText("Just a note.").quoted).toBeNull();
    expect(splitQuotedHtml("<p>Just a note.</p>").quoted).toBeNull();
  });
});

/* ── 14410: bodies keep their stylesheets, and the frame is handed one parse ── */

import { matchInlineParts, referencedCids, renderBody, styleBlocks } from "./message-body";

describe("remote content inside a <style> block", () => {
  it("holds back a remote url() and @import, counts them, and restores them", () => {
    const html = "<style>@import url(https://t.example/a.css);.h{background:url(https://t.example/p.gif)}.l{background:url(cid:logo)}</style><p>x</p>";
    const out = blockRemoteContent(html);
    expect(out.blocked).toBe(2);
    // The live stylesheet fetches nothing; the original waits on the element,
    // as `data-blocked-src` does for an image, so Show images can restore it.
    expect(out.html).toContain(">.h{background:none}.l{background:url(cid:logo)}</style>");
    expect(out.html).toContain('data-blocked-css="@import url(https://t.example/a.css)');
    expect(restoreRemoteContent(out.html)).toContain(".h{background:url(https://t.example/p.gif)}");
  });
});

describe("renderBody", () => {
  const DARK = { bg: [24, 27, 31] as [number, number, number], fg: [230, 230, 233] as [number, number, number] };

  it("resolves cid: to the fetched part, and counts it as nothing to block", () => {
    const out = renderBody('<img src="cid:Logo@X"><img src="https://t.example/p.gif">', {
      showRemote: false,
      cidUrls: { "logo@x": "blob:https://app/1" },
    });
    expect(out.html).toContain('src="blob:https://app/1"');
    expect(out.blocked).toBe(1);
  });

  it("blocks nothing once the reader or a trusted sender allows remote images", () => {
    const out = renderBody('<img src="https://t.example/p.gif">', { showRemote: true });
    expect(out.blocked).toBe(0);
    expect(out.html).toContain(' src="https://t.example/p.gif"');
  });

  it("light mode is the original; dark mode recolours", () => {
    const html = '<td style="background-color:#ffffff;color:#000000">x</td>';
    expect(renderBody(html, { showRemote: true, dark: null }).html).toContain("#ffffff");
    expect(renderBody(html, { showRemote: true, dark: DARK }).html).not.toContain("#ffffff");
  });

  it("leaves a sender's own dark design alone", () => {
    const html = "<style>@media (prefers-color-scheme: dark){p{color:#eee}}</style><p style=\"color:#000\">x</p>";
    const out = renderBody(html, { showRemote: true, dark: DARK });
    expect(out.ownDark).toBe(true);
    expect(out.html).toContain("color:#000");
  });
});

describe("the parts a body references", () => {
  it("referencedCids lists each cid once, without the scheme or brackets", () => {
    expect(referencedCids('<img src="cid:a@x"><img src="cid:<b@x>"><td background="cid:a@x">')).toEqual(["a@x", "b@x"]);
    expect(referencedCids("<p>no images</p>")).toEqual([]);
  });

  it("matchInlineParts prefers the Content-ID and falls back to the filename for legacy rows", () => {
    const rows = [
      { email_attachment_id: "1", filename: "image001.png", content_id: null },
      { email_attachment_id: "2", filename: "x.png", content_id: "logo@x" },
      { email_attachment_id: "3", filename: "b.pdf", content_id: null },
    ];
    expect(matchInlineParts(rows, ["logo@x", "image001.png@01DB1234", "missing@x"])).toEqual([
      { cid: "logo@x", part: rows[1] },
      { cid: "image001.png@01DB1234", part: rows[0] },
    ]);
  });

  it("styleBlocks hands the folded history the stylesheet it was cut away from", () => {
    expect(styleBlocks("<style>.q{color:red}</style><p>a</p><blockquote class=q>b</blockquote>")).toBe("<style>.q{color:red}</style>");
  });
});

describe("splitQuotedHtml does not mistake a stylesheet for a reply", () => {
  it("a forward that is all quotation, behind a <style>, is not folded", () => {
    const html = "<style>p{color:red}</style><blockquote>forwarded</blockquote>";
    expect(splitQuotedHtml(html).quoted).toBeNull();
  });

  it("a real reply behind a <style> still folds its history", () => {
    const html = "<style>p{color:red}</style><p>new words</p><blockquote>old</blockquote>";
    expect(splitQuotedHtml(html).quoted).toContain("old");
  });
});
