/**
 * An inbound HTML body, made safe to keep without making it ugly to read.
 *
 * ── WHAT THE FIRST POLICY GOT WRONG ─────────────────────────────────────────
 *
 * `cleanHtml` used to be sanitize-html's DEFAULT allow-list plus `<img>`. The
 * defaults allow no `style` attribute on anything, no table attribute
 * (`bgcolor`, `width`, `align`, `cellpadding`), no `<font>` and no `<center>`,
 * and they drop `<style>` blocks WITH their contents. Email is laid out with
 * exactly those things, so every message was flattened before it was written:
 * a client's dark-green header with gold type arrived as black text on the
 * app's background, in our fonts, and the only copy we kept was that one.
 *
 * Nothing about that was a safety decision. The things that make HTML
 * dangerous are script, event handlers, unsafe URL schemes, forms and frames,
 * and none of them is a colour.
 *
 * ── WHAT THIS POLICY KEEPS, AND WHY IT CAN ──────────────────────────────────
 *
 * Inline styles, the presentational attributes mail is built from, classes,
 * and `<style>` blocks (cleaned, below). That is what Gmail and Outlook on the
 * web keep, and it is safe to keep here for one reason that the old policy
 * could not rely on: the reading pane no longer injects this markup into the
 * app's own document. It renders it inside a sandboxed `<iframe srcdoc>` with
 * scripts off and its own Content-Security-Policy (`email-frame.tsx`), so the
 * message's CSS can reach only the message. A `position:fixed` box cannot
 * cover the app, a `<style>` cannot restyle it, and a `url()` the cleaner
 * missed is refused by the frame's CSP rather than fetched.
 *
 * THAT IS AN INVARIANT, NOT A DETAIL: `email_message.body_html` may now carry a
 * `<style>` element, so it must never be handed to `dangerouslySetInnerHTML`
 * in the app's own document again. Render it through `EmailFrame`.
 *
 * ── WHAT IT STILL REMOVES ───────────────────────────────────────────────────
 *
 *   · script, every `on*` handler, `<form>`, `<iframe>`, `<object>`, `<embed>`,
 *     `<meta>`, `<link>` and `<base>`, by not allowing them;
 *   · `javascript:`, `vbscript:` and every other scheme not listed below;
 *   · the CONTENTS of `<title>`, `<xml>`, `<noscript>` and the rest of
 *     `NON_TEXT`, which would otherwise surface as stray words in the body (an
 *     Outlook message carries its Office settings in an `<xml>` island);
 *   · in CSS: `@import`, `@charset`, `@namespace`, `expression()`, `behavior`,
 *     `-moz-binding`, and any `url()` with a script scheme.
 *
 * Remote images are NOT removed here. Whether to fetch them is a per-reader
 * privacy decision taken at render time (§5.6.3, `message-body.ts`), and
 * deleting them on ingest would make "Show images" impossible.
 *
 * ── THE ORIGINAL IS KEPT BESIDE IT ──────────────────────────────────────────
 *
 * `ingestMessage` stores the sender's HTML untouched in `body_html_original`
 * and this function's output in `body_html`, stamped with `BODY_POLICY`. The
 * original is never rendered and never returned by a list or detail read. It
 * exists so that the next change to this file is a re-run over stored data
 * (`repairBody`) and not a re-fetch of every message from the provider, which
 * is what this change has to do for the mail stored under the old policy.
 *
 * Bump `BODY_POLICY` whenever the output of `cleanHtml` changes for the same
 * input. A row stamped lower is re-cleaned from its original the next time
 * somebody opens it.
 */
"use strict";

/** The version of the rules below. NULL on a row means "before this file". */
const BODY_POLICY = 1;

/** Past this, a `<style>` block is dropped and the inline styles carry it. */
const MAX_CSS_BYTES = 128 * 1024;

const EXTRA_TAGS = ["img", "font", "center", "style", "big", "tt", "strike", "del", "ins"];

/** Disallowed tags whose TEXT must go with them. See the header. */
const NON_TEXT = [
  "script", "textarea", "option", "select", "xmp", "noscript", "noembed", "noframes",
  "title", "xml", "object", "embed", "iframe", "frameset", "template", "button",
];

/** What mail is laid out with. Every one is presentational; none runs. */
const ATTRS = {
  "*": [
    "style", "class", "id", "dir", "lang", "title", "align", "valign", "width", "height",
    "bgcolor", "background", "border", "role", "aria-hidden", "aria-label",
  ],
  a: ["href", "name", "target", "rel"],
  img: ["src", "srcset", "alt", "width", "height", "border", "hspace", "vspace"],
  table: ["cellpadding", "cellspacing", "border", "summary", "frame", "rules"],
  td: ["colspan", "rowspan", "nowrap", "scope", "abbr", "headers"],
  th: ["colspan", "rowspan", "nowrap", "scope", "abbr", "headers"],
  col: ["span"],
  colgroup: ["span"],
  font: ["color", "face", "size"],
  ol: ["start", "type", "reversed"],
  ul: ["type"],
  li: ["value", "type"],
  blockquote: ["cite", "type"],
  hr: ["size", "noshade", "color"],
  time: ["datetime"],
  data: ["value"],
  div: ["data-email-body"],
};

/**
 * CSS, cleaned of the constructs that fetch or run.
 *
 * Every pattern here is a single pass with no nested quantifier: this runs on
 * every stored body, and a backtracking regex over a 100 KB stylesheet is a
 * denial of service a sender can trigger by writing one.
 *
 * `<` is escaped as the CSS escape `\3c `. It can only appear in a string or a
 * comment in valid CSS, both of which accept the escape, and it is the one
 * character that could close the `<style>` element this text goes back into.
 */
function cleanCss(css) {
  let out = stripComments(String(css || ""));
  if (!out.trim()) return "";
  out = out
    .replace(/@(?:import|charset|namespace)\b[^;{}]*;?/gi, "")
    .replace(/expression\s*\(/gi, "x(")
    .replace(/(?:behavior|-moz-binding)\s*:[^;{}]*/gi, "")
    // The scheme is replaced, not the whole `url(…)`: a script URL routinely
    // contains its own parentheses, so "up to the first `)`" is not the token.
    .replace(/url\(\s*(["']?)(?:javascript|vbscript|data:text\/html)/gi, "url($1about:invalid")
    .replace(/</g, "\\3c ");
  return out.trim();
}

/**
 * CSS comments, removed by scanning rather than by `/\*[\s\S]*?\*\//`.
 *
 * The lazy pattern is quadratic on a stylesheet of unterminated `/*` openers:
 * every one of them scans to the end before failing. An unterminated comment
 * runs to the end of the sheet, which is also what a browser does with it.
 */
function stripComments(css) {
  let out = "";
  let i = 0;
  for (;;) {
    const open = css.indexOf("/*", i);
    if (open === -1) return out + css.slice(i);
    out += css.slice(i, open);
    const close = css.indexOf("*/", open + 2);
    if (close === -1) return out;
    i = close + 2;
  }
}

/** The same rules for one `style="…"` attribute. */
const cleanStyleAttr = (value) => cleanCss(value).replace(/[{}]/g, "");

/**
 * Sanitize an inbound HTML body before it is stored. Returns null for nothing.
 *
 * `<style>` blocks are taken OUT during the sanitize pass and put back, cleaned,
 * at the front. sanitize-html re-emits a style element's text raw and offers no
 * hook to rewrite it, so the only way to clean the CSS without matching HTML
 * with a regex is to be handed the text by the parser itself, which
 * `exclusiveFilter` does (`frame.text`). Order between blocks is preserved;
 * their position in the document never mattered to the cascade.
 */
function cleanHtml(html) {
  if (!html) return null;

  const sanitize = require("sanitize-html");
  const styles = [];
  let cssBytes = 0;

  const out = sanitize(String(html), {
    allowedTags: sanitize.defaults.allowedTags.concat(EXTRA_TAGS),
    allowVulnerableTags: true,
    allowedAttributes: ATTRS,
    allowedSchemes: ["http", "https", "mailto", "tel", "cid"],
    allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
    allowedSchemesAppliedToAttributes: ["href", "src", "cite", "background"],
    nonTextTags: NON_TEXT,
    transformTags: {
      // The body's own background and padding are part of the design. The tag
      // is dropped (this is a fragment), so its attributes move to a div.
      body: (tagName, attribs) => ({ tagName: "div", attribs: { ...attribs, "data-email-body": "" } }),
      // Every link leaves the frame for a new tab, and tells the destination
      // nothing about where it was clicked from.
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }),
      "*": (tagName, attribs) => {
        if (attribs.style === undefined) return { tagName, attribs };
        const style = cleanStyleAttr(attribs.style);
        const next = { ...attribs };
        if (style) next.style = style; else delete next.style;
        return { tagName, attribs: next };
      },
    },
    exclusiveFilter: (frame) => {
      if (frame.tag !== "style") return false;
      if (String(frame.text || "").length > MAX_CSS_BYTES * 2) return true;
      const css = cleanCss(frame.text);
      if (css && cssBytes + css.length <= MAX_CSS_BYTES) {
        styles.push(css);
        cssBytes += css.length;
      }
      return true;
    },
  });

  // Whether anything a reader could see survived: text, or an image. A body
  // that cleans down to a bare wrapper is stored as null, so the pane falls back
  // to the text part instead of drawing an empty frame over it. A second pass
  // keeping only `<img>` answers that without matching markup by hand.
  const visible = sanitize(out, { allowedTags: ["img"], allowedAttributes: { img: ["src"] }, nonTextTags: NON_TEXT });
  if (!String(visible || "").trim()) return null;
  const head = styles.length ? `<style>${styles.join("\n")}</style>` : "";
  return head + out;
}

module.exports = { BODY_POLICY, cleanHtml, cleanCss };
