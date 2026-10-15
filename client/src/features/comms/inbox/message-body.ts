/**
 * What the reading pane actually renders: images held back, history folded.
 *
 * ── REMOTE IMAGES ARE BLOCKED UNTIL SOMEBODY ASKS (§5.6.3) ──────────────────
 *
 * Q32 removed our own telemetry — no tracking pixel, no link rewriting — on the
 * grounds that EU counterparties and an EU entity make read tracking the wrong
 * trade. That decision protects the people we write to. It does nothing for the
 * people who work here, who are on the receiving end of everybody ELSE's
 * pixels: a 1×1 GIF in a supplier's footer reports the moment an invoice was
 * opened, from what IP, on what device, every time the message is displayed.
 *
 * Blocking remote images by default is the only privacy control the programme
 * has left on the inbound side, and §5.6.3 names it. It is also the standard
 * behaviour of every serious mail client, so it surprises nobody.
 *
 * WHAT IS BLOCKED, PRECISELY. Anything the browser would fetch from a host we
 * do not control while rendering the message: `src`, `srcset`, `poster` and
 * `background` on any element, and CSS `url()` inside an inline `style`.
 * `cid:` and `data:` are LEFT ALONE — a `cid:` part came with the message and
 * is served from our own store, and a `data:` URI is bytes already in hand.
 * Neither reaches a third party, and blocking them would hide the signature
 * logo on every internal mail for no gain.
 *
 * WHY THE ORIGINAL URL IS KEPT. Moved to `data-blocked-src`, not deleted, so
 * "Show images" is a re-render rather than a re-fetch of the message — and so
 * the alt text still has something to be the alternative TO.
 *
 * ── WHY THIS PARSES RATHER THAN PATTERN-MATCHES ─────────────────────────────
 *
 * The first version of this file did the whole job with regexes, on the
 * argument that the HTML is already sanitized (`mail.service.cleanHtml` runs on
 * ingest) so nothing security-critical was riding on the parse. The argument
 * was wrong twice over.
 *
 * It was wrong on the merits: `\ssrc\s*=\s*("[^"]*"|'[^']*')` requires QUOTES,
 * and `<img src=https://track.example/p.gif>` is valid HTML that no browser
 * needs quotes for. Every unquoted pixel went straight through the control
 * whose entire job is to stop pixels. A privacy filter with a hole shaped like
 * "the attacker omits two characters" is not a filter.
 *
 * And it was wrong about the risk: CodeQL's `js/bad-tag-filter` flagged the
 * tag-stripping regex below at high severity on PR #271, and it was right to.
 * Matching HTML with regular expressions is a losing game whose failure mode is
 * always silent.
 *
 * So it parses. `parseBody` below explains which parser and why — the short
 * version is that we get the browser's own understanding of what an attribute
 * is, without the browser doing anything about what it finds.
 *
 * ── QUOTED HISTORY IS FOLDED, NOT DROPPED (§5.6.3) ──────────────────────────
 *
 * A ten-message thread renders the same ten messages nested inside each other,
 * so the last one is ten copies deep and the reader scrolls through the whole
 * exchange to reach two new sentences. Every mail client folds this; §5.6.3
 * specifies the three signals to fold on, in BOTH languages, because half this
 * tenant's correspondence is French:
 *
 *   · `<blockquote>` — what most clients emit
 *   · `>` line prefixes — what plain-text mailers emit
 *   · "On … wrote:" / "Le … a écrit :" — the attribution line above either
 *
 * Folded, never dropped: the history is one click away and still selectable in
 * the plain-text branch. A mail client that quietly deletes the quotation is
 * one you cannot use to settle an argument about who said what.
 */

import { hasOwnDarkMode, recolourFragment, type DarkTheme } from "./email-dark";

/** The attributes that make a browser fetch something while rendering. */
const URL_ATTRS = ["src", "srcset", "poster", "background"] as const;

/** `cid:` and `data:` never leave the building; everything else might. */
const isRemote = (url: string): boolean => {
  const v = String(url || "").trim();
  if (!v) return false;
  return !/^(cid:|data:|blob:)/i.test(v);
};

/** A srcset descriptor: `2x`, `1.5x`, `640w`. Everything else is a URL. */
const DESCRIPTOR = /^\d+(?:\.\d+)?[wx]$/i;

/**
 * The URLs inside a `srcset`, which is the one attribute here that holds more
 * than one.
 *
 * ── WHY NEITHER OBVIOUS SPLIT IS CORRECT ────────────────────────────────────
 *
 * A srcset is a comma-separated candidate list, each candidate a URL and an
 * optional whitespace-separated descriptor:
 *
 *     cid:logo 1x, https://track.example/p.gif 2x
 *
 * Splitting on COMMAS breaks `data:image/png;base64,AAAB` in half, and the tail
 * (`AAAB`) has no local scheme, so an inline image reads as remote and gets
 * blocked — a false positive that hides a legitimate logo behind "Show images".
 *
 * Splitting on WHITESPACE breaks `url1,url2`, a candidate list with no
 * descriptors and therefore no spaces — and there the failure is the dangerous
 * direction: the whole thing is tested as one URL, so a leading `cid:` makes a
 * trailing `https://` look local.
 *
 * So: split on whitespace first (a URL never contains any), then split each
 * remaining token on commas — except a `data:` token, which is the one URL that
 * legitimately contains a comma and cannot contain a space. Descriptors are
 * dropped at both levels, because `1x,cid:b` is one token holding both.
 */
function srcsetUrls(value: string): string[] {
  const urls: string[] = [];
  for (const token of value.split(/\s+/)) {
    const t = token.replace(/,+$/, "");
    if (!t || DESCRIPTOR.test(t)) continue;
    if (/^data:/i.test(t)) { urls.push(t); continue; }
    for (const piece of t.split(",")) {
      if (piece && !DESCRIPTOR.test(piece)) urls.push(piece);
    }
  }
  return urls;
}

/**
 * Does this attribute value reference anything remote?
 *
 * Any remote candidate makes the whole attribute remote. There is no
 * per-candidate blocking to do: the attribute is moved aside whole, so a mixed
 * list is held back entirely and restored entirely.
 */
function referencesRemote(attr: string, value: string): boolean {
  if (attr !== "srcset") return isRemote(value);
  return srcsetUrls(value).some(isRemote);
}

/**
 * Parse a message body into an inert fragment.
 *
 * ── TWO PROPERTIES, BOTH LOAD-BEARING ───────────────────────────────────────
 *
 * INERT. A `<template>`'s contents live in a separate "template contents owner
 * document" with no browsing context, so `<img src="https://track.example/
 * p.gif">` is parsed and NOT fetched. If this were
 * `document.createElement("div").innerHTML = html`, the pixel would fire inside
 * the very function written to stop it.
 *
 * TABLE-SAFE. `DOMParser.parseFromString(html, "text/html")` parses in BODY
 * context, and the HTML tree-construction algorithm silently discards
 * table-only elements that appear without a table ancestor — a body that
 * begins mid-table loses its `<td>`s, and this function's output is what the
 * reading pane renders. Mail is table-based HTML (our own `compose.js` emits
 * a table layout), so "silently drops table cells" is not a corner case here.
 * `<template>` parses in TEMPLATE context, which permits them.
 *
 * The empty `DOMParser` document is only there to own the element; nothing is
 * parsed into it.
 */
const OWNER = () => new DOMParser().parseFromString("", "text/html");

function parseBody(html: string): { doc: Document; root: DocumentFragment } {
  const doc = OWNER();
  const tpl = doc.createElement("template");
  tpl.innerHTML = html;
  return { doc, root: tpl.content };
}

/** Serialise a fragment back to the HTML the pane will render. */
function serialize(doc: Document, root: Node): string {
  const box = doc.createElement("div");
  box.appendChild(root.cloneNode(true));
  return box.innerHTML;
}

export type BodyScan = {
  /** The HTML with remote references neutralised. */
  html: string;
  /** How many references were held back — 0 means nothing to offer. */
  blocked: number;
};

/** Neutralise every remote reference in a message body. */
export function blockRemoteContent(html: string): BodyScan {
  if (!html) return { html: "", blocked: 0 };

  const { doc, root } = parseBody(html);
  const blocked = blockIn(root);
  return { html: serialize(doc, root), blocked };
}

/**
 * A remote `url()` in a stylesheet, and an `@import`.
 *
 * Bodies stored since 14410 keep their `<style>` blocks, and a stylesheet can
 * fetch as surely as an `<img>` can: a `background-image`, an `@font-face`
 * `src`, an `@import`. The frame's CSP refuses all three anyway; neutralising
 * them here is what makes the banner's count honest, so "Show images" is
 * offered for a message whose only remote content is in its CSS.
 *
 * The original text is kept on the element, as the attributes above are, so
 * showing images restores rather than re-fetches.
 */
const CSS_URL = /url\([^)]*\)/gi;
const CSS_IMPORT = /@import\b[^;]*;?/gi;

function blockStyle(el: Element): number {
  const css = el.textContent || "";
  let blocked = 0;
  const cleaned = css
    .replace(CSS_IMPORT, () => {
      blocked += 1;
      return "";
    })
    .replace(CSS_URL, (whole) => {
      const inner = whole.slice(4, -1).trim().replace(/^['"]|['"]$/g, "");
      if (!isRemote(inner)) return whole;
      blocked += 1;
      return "none";
    });
  if (blocked) {
    el.setAttribute("data-blocked-css", css);
    el.textContent = cleaned;
  }
  return blocked;
}

/** The blocking pass over an already-parsed fragment. Returns how many it held. */
function blockIn(root: ParentNode): number {
  let blocked = 0;

  for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    if (el.tagName.toLowerCase() === "style") {
      blocked += blockStyle(el);
      continue;
    }
    for (const attr of URL_ATTRS) {
      const value = el.getAttribute(attr);
      if (value == null || !referencesRemote(attr, value)) continue;
      el.removeAttribute(attr);
      el.setAttribute(`data-blocked-${attr}`, value);
      blocked += 1;
    }

    // A background image is a pixel with extra steps, and it is the one people
    // forget. The whole declaration is neutralised rather than surgically
    // edited: `style` here is an inline attribute on sanitized markup, and
    // rewriting one `url()` inside a shorthand correctly is the same losing
    // game as the regexes this file stopped playing.
    const style = el.getAttribute("style");
    if (style && /url\(/i.test(style)) {
      const cleaned = style.replace(/url\([^)]*\)/gi, (whole) => {
        const inner = whole.slice(4, -1).trim().replace(/^['"]|['"]$/g, "");
        if (!isRemote(inner)) return whole;
        blocked += 1;
        return "none";
      });
      if (cleaned !== style) el.setAttribute("style", cleaned);
    }
  }

  return blocked;
}

/** Put back what `blockRemoteContent` held, for "Show images". */
export function restoreRemoteContent(html: string): string {
  if (!html) return "";
  const { doc, root } = parseBody(html);
  for (const el of Array.from(root.querySelectorAll("style[data-blocked-css]"))) {
    el.textContent = el.getAttribute("data-blocked-css") || "";
    el.removeAttribute("data-blocked-css");
  }
  for (const attr of URL_ATTRS) {
    for (const el of Array.from(
      root.querySelectorAll<HTMLElement>(`[data-blocked-${attr}]`),
    )) {
      const value = el.getAttribute(`data-blocked-${attr}`);
      if (value != null) el.setAttribute(attr, value);
      el.removeAttribute(`data-blocked-${attr}`);
    }
  }
  return serialize(doc, root);
}

/**
 * The attribution line that introduces a quotation, in English and French.
 *
 * Required to END in a colon, because "on Tuesday we wrote:" mid-paragraph is
 * prose, not an attribution. The French form takes a non-breaking space before
 * the colon (Outlook and Thunderbird both emit one) as well as a plain one —
 * written as the escape `\u00a0`, never typed: a literal one in source is
 * invisible to whoever reads this next, and `no-irregular-whitespace` rejects
 * it for exactly that reason.
 *
 * The caller trims before testing, so this anchors with `^` and `$` and carries
 * no leading or trailing `\s*`. That is not tidiness: `\s*$` after a literal is
 * the classic polynomial-backtracking shape, and this runs once per line of
 * every message body.
 */
const ATTRIBUTION =
  /^(?:>+ ?)?(?:On\s.{0,200}?\swrote:|Le\s.{0,200}?\sa\s[ée]crit[\u00a0 ]?:|-{2,}\s?(?:Original Message|Message d'origine|Forwarded message|Message transf[ée]r[ée])\s?-{2,})$/i;

/** Is this line the "On … wrote:" that introduces a quotation? */
const isAttribution = (line: string) => ATTRIBUTION.test(line.trim());

export type SplitBody = { visible: string; quoted: string | null };

/**
 * Split a PLAIN-TEXT body into what is new and what is history.
 *
 * The cut is made at whichever comes first: the attribution line, or the start
 * of an unbroken run of `>`-prefixed lines that reaches the end. Requiring it
 * to reach the end matters — somebody who quotes one line, answers it, and
 * quotes another has written an interleaved reply, and folding from the first
 * `>` would hide half of their answer.
 */
export function splitQuotedText(text: string): SplitBody {
  const body = String(text || "");
  if (!body.trim()) return { visible: body, quoted: null };

  const lines = body.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    if (!isAttribution(lines[i])) continue;
    // Nothing above it is not a quotation, it is the whole message.
    if (!lines.slice(0, i).join("").trim()) break;
    return {
      visible: trimEnd(lines.slice(0, i).join("\n")),
      quoted: lines.slice(i).join("\n"),
    };
  }

  // The trailing `>` run.
  let cut = lines.length;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i];
    if (/^ *>/.test(l)) { cut = i; continue; }
    if (!l.trim() && cut < lines.length) continue; // blank lines inside the run
    break;
  }
  if (cut < lines.length && lines.slice(0, cut).join("").trim()) {
    return {
      visible: trimEnd(lines.slice(0, cut).join("\n")),
      quoted: lines.slice(cut).join("\n"),
    };
  }

  return { visible: body, quoted: null };
}

/**
 * The native `trimEnd`, wrapped only so the call sites read as intent.
 *
 * Deliberately NOT `replace(/\s+$/, "")`: a trailing-whitespace regex on a
 * message-sized string is the classic polynomial-backtracking shape, and this
 * runs on every body the pane renders. The engine's own trim has none of that.
 */
function trimEnd(s: string): string {
  return s.trimEnd();
}

/**
 * The words a reader would see in a node. A `<style>` element's CSS is text
 * to the DOM and nothing to a reader, and since 14410 every styled body starts
 * with one, so "is there anything above the quotation" must not count it.
 */
function readable(node: Node): string {
  if (node.nodeType === 1 && (node as Element).tagName.toLowerCase() === "style") return "";
  if (node.nodeType !== 1 && node.nodeType !== 11) return node.textContent || "";
  const copy = node.cloneNode(true) as Element | DocumentFragment;
  for (const s of Array.from(copy.querySelectorAll("style"))) s.remove();
  return copy.textContent || "";
}

/**
 * Split an HTML body at the FIRST `<blockquote>`, or at an attribution line.
 *
 * The first blockquote is the right cut and nesting needs no counting: a thread
 * quotes itself outside-in, so the outermost quotation opens first in document
 * order and everything after it — however deeply nested — is history.
 *
 * A `Range` does the cutting rather than a substring, which is what makes both
 * of the shapes mail clients actually emit come out right:
 *
 *   <div>reply</div><div class="gmail_quote"><blockquote>…      → clean split
 *   <div>reply<blockquote>…</blockquote></div>                  → the div is
 *     partially selected, and `extractContents` splits it, so "reply" stays
 *     visible and the blockquote leaves inside a clone of its wrapper.
 *
 * A quotation that starts at the very beginning is NOT folded: that is a
 * forward whose entire content is the quoted message, and folding it would show
 * the reader an empty message with a "show history" link.
 */
export function splitQuotedHtml(html: string): SplitBody {
  const body = String(html || "");
  if (!body.trim()) return { visible: body, quoted: null };

  const { doc, root } = parseBody(body);
  const bq = root.querySelector("blockquote");

  if (bq) {
    const before = doc.createRange();
    before.setStart(root, 0);
    before.setEndBefore(bq);
    // Text, not markup: a wrapper `<div>` above the quotation is not a reply,
    // and neither is the stylesheet the sanitizer puts at the front.
    if (!readable(before.cloneContents()).trim()) return { visible: body, quoted: null };

    const rest = doc.createRange();
    rest.setStartBefore(bq);
    rest.setEnd(root, root.childNodes.length);
    const box = doc.createElement("div");
    box.appendChild(rest.extractContents());
    return { visible: serialize(doc, root), quoted: box.innerHTML };
  }

  /* No blockquote: fall back to the attribution line, which Gmail's plain
   * "On … wrote:" + <div> form produces without ever opening one. Walked as
   * top-level nodes rather than split on `<br>` — the DOM already knows where
   * the blocks are, and `textContent` is exact where tag-stripping was not. */
  const nodes = Array.from(root.childNodes);
  for (let i = 1; i < nodes.length; i += 1) {
    if (!isAttribution(nodes[i].textContent || "")) continue;
    const head = nodes.slice(0, i);
    if (!head.map(readable).join("").trim()) break;

    const rest = doc.createRange();
    rest.setStartBefore(nodes[i]);
    rest.setEnd(root, root.childNodes.length);
    const box = doc.createElement("div");
    box.appendChild(rest.extractContents());
    return { visible: serialize(doc, root), quoted: box.innerHTML };
  }

  return { visible: body, quoted: null };
}


/* ── What the sealed frame is handed ─────────────────────────────────────── */

export type RenderOptions = {
  /** The reader asked for remote images, or the sender is trusted for them. */
  showRemote: boolean;
  /** Inline parts already fetched as blob URLs, keyed by Content-ID. */
  cidUrls?: Record<string, string>;
  /** Recolour for dark mode against these anchors; null in light mode. */
  dark?: DarkTheme | null;
};

export type RenderedBody = {
  html: string;
  /** Remote references held back; 0 when images are shown or there were none. */
  blocked: number;
  /** The message carries its own `prefers-color-scheme` design and was not recoloured. */
  ownDark: boolean;
};

/** `cid:Foo@x` → the blob URL for that part, matching case-insensitively as a fallback. */
function resolveCid(value: string, cidUrls: Record<string, string>): string | null {
  const id = value.trim().replace(/^cid:/i, "").replace(/^<|>$/g, "");
  if (!id) return null;
  if (cidUrls[id]) return cidUrls[id];
  const lower = id.toLowerCase();
  const key = Object.keys(cidUrls).find((k) => k.toLowerCase() === lower);
  return key ? cidUrls[key] : null;
}

function resolveCidsIn(root: ParentNode, cidUrls: Record<string, string>): void {
  if (!Object.keys(cidUrls).length) return;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[src], [background]"))) {
    for (const attr of ["src", "background"]) {
      const v = el.getAttribute(attr);
      if (!v || !/^cid:/i.test(v.trim())) continue;
      const url = resolveCid(v, cidUrls);
      if (url) el.setAttribute(attr, url);
    }
  }
}

/**
 * The HTML the sealed frame renders: parsed ONCE, then blocked, resolved and
 * recoloured on that one fragment.
 *
 * Order matters in one place: blocking runs before `cid:` resolution, because a
 * resolved inline part is a `blob:` URL and is local by definition, and running
 * the other way round would only work by the accident that `isRemote` also
 * passes `blob:`.
 */
export function renderBody(html: string, { showRemote, cidUrls = {}, dark = null }: RenderOptions): RenderedBody {
  if (!html) return { html: "", blocked: 0, ownDark: false };
  const { doc, root } = parseBody(html);
  const blocked = showRemote ? 0 : blockIn(root);
  resolveCidsIn(root, cidUrls);
  const ownDark = hasOwnDarkMode(root);
  if (dark && !ownDark) recolourFragment(root, dark);
  return { html: serialize(doc, root), blocked, ownDark };
}

/**
 * The `<style>` blocks of a body, as markup.
 *
 * The quoted history is cut out of the body below the reply, and the sanitizer
 * moves every stylesheet to the front, so the cut leaves the history's classes
 * with no rules. The folded history is rendered with these prepended.
 */
export function styleBlocks(html: string): string {
  if (!html) return "";
  const { doc, root } = parseBody(html);
  const box = doc.createElement("div");
  for (const s of Array.from(root.querySelectorAll("style"))) box.appendChild(s.cloneNode(true));
  return box.innerHTML;
}

/** The Content-IDs a body references, so only those parts are fetched. */
export function referencedCids(html: string): string[] {
  if (!html || !/cid:/i.test(html)) return [];
  const { root } = parseBody(html);
  const out = new Set<string>();
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[src], [background]"))) {
    for (const attr of ["src", "background"]) {
      const v = (el.getAttribute(attr) || "").trim();
      if (/^cid:/i.test(v)) out.add(v.replace(/^cid:/i, "").replace(/^<|>$/g, ""));
    }
  }
  return [...out];
}

/** The part of an attachment row `matchInlineParts` reads. */
export type InlineCandidate = {
  email_attachment_id: string;
  filename?: string | null;
  content_id?: string | null;
};

/**
 * Which stored attachment each `cid:` in the body is.
 *
 * By Content-ID first, as RFC 2392 intends. Then, for parts stored before the
 * id was recorded (every inbound attachment until 14410), by filename: Outlook
 * names its inline parts `image001.png@01DB…`, Gmail `ii_…`, and in both the
 * part before the `@` is the filename the part was stored under. A cid that
 * matches nothing stays a cid, and draws as the broken image it always was.
 */
export function matchInlineParts<T extends InlineCandidate>(rows: T[], cids: string[]): { cid: string; part: T }[] {
  const out: { cid: string; part: T }[] = [];
  const used = new Set<string>();
  for (const cid of cids) {
    const lower = cid.toLowerCase();
    const stem = lower.split("@")[0];
    const free = rows.filter((r) => !used.has(r.email_attachment_id));
    const hit =
      free.find((r) => r.content_id === cid)
      || free.find((r) => String(r.content_id || "").toLowerCase() === lower)
      || free.find((r) => !r.content_id && stem && String(r.filename || "").toLowerCase() === stem);
    if (!hit) continue;
    used.add(hit.email_attachment_id);
    out.push({ cid, part: hit });
  }
  return out;
}
