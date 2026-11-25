"use strict";

/**
 * Markdown with front matter → an article patch (Settings › Website › Articles
 * › Import, doc/smartls-website/ENGINEERING_GUIDE.md PR 5).
 *
 * ── WHY A SMALL PARSER AND NOT A YAML LIBRARY ──────────────────────────────
 *
 * The front matter an article needs is a dozen flat keys: strings, one list,
 * one date. A YAML library would accept far more than that (anchors, tags,
 * custom types) from a file a person dropped into a browser, and every feature
 * it parses is one this endpoint would have to think about. This reads exactly
 * the shape the writers use and says plainly when a file is something else.
 *
 * The accepted shape:
 *
 *   ---
 *   title: Why We Started With Customs
 *   slug: why-we-started-with-customs
 *   date: 2021-03-15
 *   kind: article                  # or announcement
 *   language: en                   # or fr; default en
 *   tags: [company, customs]       # or a "- item" list on the lines below
 *   byline: Timothée Massomba
 *   role: Managing Director
 *   excerpt: Two sentences under the headline.
 *   meta_title: …                  # or a `meta:` block with title / description
 *   meta_description: …
 *   ---
 *   The body, in the Markdown subset the public site renders.
 *
 * Keys this file does not know (a writer's `sources:` list, a `note:` for the
 * editor) are reported back as ignored rather than refused, so the working
 * notes can live in the same file the owner reads.
 *
 * Requires nothing, so it is unit-testable without a database or Redis.
 */

const FENCE = /^---[ \t]*$/;

/** Strip one layer of matching quotes, and the YAML escapes a writer types. */
function unquote(raw) {
  const v = String(raw).trim();
  if (v.length >= 2 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    const inner = v.slice(1, -1);
    return v[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner.replace(/''/g, "'");
  }
  // A trailing ` # comment` on an unquoted value is a comment, as in YAML.
  return v.replace(/\s+#.*$/, "").trim();
}

/** `[a, "b c", d]` → ["a", "b c", "d"]. Commas inside quotes are kept. */
function inlineList(raw) {
  const inner = raw.trim().slice(1, -1);
  const out = [];
  let cur = "";
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map(unquote).filter(Boolean);
}

/**
 * Split a file into its front matter (a flat object) and its body.
 *
 * Returns `{ data, body }`, or throws an Error whose message is written for the
 * person who dropped the file, because that is who reads it.
 */
function parseFrontMatter(text) {
  const src = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = src.split("\n");
  if (!FENCE.test(lines[0] || "")) {
    throw new Error("The file does not start with front matter (a line of three hyphens).");
  }
  const end = lines.findIndex((l, i) => i > 0 && FENCE.test(l));
  if (end === -1) throw new Error("The front matter is never closed (no second line of three hyphens).");

  const data = {};
  let listKey = null;
  let blockKey = null;
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const item = /^\s+-\s+(.*)$/.exec(line) || /^-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }
    const nested = /^\s+([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (nested && blockKey) {
      data[`${blockKey}_${nested[1].toLowerCase()}`] = unquote(nested[2]);
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`Line ${i + 1} of the front matter is not "key: value".`);
    const key = kv[1].toLowerCase().replace(/-/g, "_");
    const value = kv[2];
    listKey = null;
    blockKey = null;
    if (!value.trim()) {
      // Either a list (`- item` lines follow) or a block (`  title: …` follows).
      const next = lines[i + 1] || "";
      if (/^\s*-\s+/.test(next)) {
        data[key] = [];
        listKey = key;
      } else {
        blockKey = key;
      }
      continue;
    }
    data[key] = /^\s*\[.*\]\s*$/.test(value) ? inlineList(value) : unquote(value);
  }
  const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
  return { data, body };
}

/** The keys an import writes; anything else is reported as ignored. */
const KNOWN = new Set([
  "title", "slug", "date", "kind", "language", "lang", "tags", "byline", "role",
  "excerpt", "meta_title", "meta_description", "meta", "standfirst",
]);

/**
 * Front matter → the patch `insight.validator`'s create schema expects, plus
 * the keys that were ignored. The language decides which half of each
 * bilingual pair is filled; the other half is left empty for a translator.
 *
 * Validation (slug shape, lengths, the date) is NOT repeated here: the result
 * goes through the same create schema as an article typed in the editor, so an
 * imported draft can never be something the editor could not have saved.
 */
function toPatch({ data, body }) {
  const lang = String(data.language || data.lang || "en").toLowerCase().startsWith("fr") ? "fr" : "en";
  const sfx = `_${lang}`;
  const patch = { kind: data.kind ? String(data.kind).toLowerCase() : "article" };
  if (data.title) patch[`title${sfx}`] = data.title;
  if (data.slug) patch[`slug${sfx}`] = String(data.slug).toLowerCase();
  const excerpt = data.excerpt || data.standfirst;
  if (excerpt) patch[`excerpt${sfx}`] = excerpt;
  if (body) patch[`body${sfx}`] = body;
  const metaTitle = data.meta_title || null;
  const metaDescription = data.meta_description || (typeof data.meta === "string" ? data.meta : null);
  if (metaTitle) patch[`meta_title${sfx}`] = metaTitle;
  if (metaDescription) patch[`meta_description${sfx}`] = metaDescription;
  if (data.tags !== undefined) {
    patch.tags = (Array.isArray(data.tags) ? data.tags : String(data.tags).split(","))
      .map((t) => String(t).trim())
      .filter(Boolean);
  }
  if (data.byline) patch.byline_name = data.byline;
  if (data.role) patch.byline_role = data.role;
  if (data.date) patch.published_at = String(data.date);

  const ignored = Object.keys(data).filter(
    (k) => !KNOWN.has(k) && !k.startsWith("meta_"),
  );
  return { patch, lang, ignored };
}

module.exports = { parseFrontMatter, toPatch, unquote, inlineList };
