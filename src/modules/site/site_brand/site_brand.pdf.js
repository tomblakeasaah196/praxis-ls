"use strict";
/**
 * A trust document as a designed PDF: the company's letterhead, the title set
 * large, a ruled block of facts (version, effective date, approved by), the
 * body, and the letterhead's own foot.
 *
 * ── IT PRINTS THE PUBLISHED COPY, NOTHING ELSE ─────────────────────────────
 *
 * `doc` is one language of `site_document.published`, the frozen copy the
 * public page serves. So the PDF a procurement officer downloads and the page
 * they read cannot disagree: both come from the same snapshot.
 *
 * ── THE BODY IS THE SAME MARKDOWN SUBSET THE PAGE RENDERS ──────────────────
 *
 * Headings, paragraphs, bulleted and numbered lists, bold, italic and links.
 * Every character is escaped before any tag is added, so the only markup in
 * the output is markup this file wrote. That is the rule the public renderer
 * (`public-web/src/components/ui/markdown.tsx`) follows with React nodes.
 */

const k = require("../../../services/documents/templates/kit");

const SAFE_HREF = /^(https?:|mailto:)/i;

/** Inline: escape first, then the four inline forms on the escaped text. */
function inline(text) {
  return k
    .esc(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) =>
      SAFE_HREF.test(href) ? `<a href="${href}">${label}</a>` : label);
}

/** Block level: one pass over the lines, closing a list when its run ends. */
function markdownToHtml(src) {
  const out = [];
  let list = null;
  let para = [];
  // A line ending in two spaces is a hard break (standard Markdown), which is
  // how an address block keeps one line per line.
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map((l, i) => inline(l.trim()) + (i < para.length - 1 ? (/ {2}$/.test(l) ? "<br>" : " ") : "")).join("")}</p>`);
    }
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of String(src || "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, (ws) => (/ {2}$/.test(ws) ? "  " : ""));
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      closeList();
    } else if (heading) {
      flushPara();
      closeList();
      // The document's own title is the h1 on the cover, so a heading is never
      // above h2 and the outline stays correct.
      const level = Math.min(4, Math.max(2, heading[1].length));
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet || numbered) {
      flushPara();
      const want = bullet ? "ul" : "ol";
      if (list !== want) {
        closeList();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${inline((bullet || numbered)[1])}</li>`);
    } else {
      closeList();
      para.push(line.replace(/^\s+/, ""));
    }
  }
  flushPara();
  closeList();
  return out.join("\n");
}

const STYLE = (cfg) => `<style>
  .sd-cover { padding: 22px 0 6px; }
  .sd-kicker { font-size: 9.5px; text-transform: uppercase; letter-spacing: .16em; margin: 0 0 6px; }
  .sd-title { font-size: 28px; line-height: 1.12; margin: 0; letter-spacing: -0.015em; }
  .sd-summary { font-size: 13px; line-height: 1.55; margin: 10px 0 0; max-width: 150mm; }
  .sd-facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin: 16px 0 18px;
              border-top: 1px solid ${cfg.line || "#E4ECF6"}; border-bottom: 1px solid ${cfg.line || "#E4ECF6"}; }
  .sd-facts div { padding: 8px 10px 8px 0; }
  .sd-facts .l { font-size: 9px; text-transform: uppercase; letter-spacing: .12em; }
  .sd-facts .v { font-size: 11.5px; font-weight: 600; margin-top: 2px; }
  .sd-body { font-size: 11.5px; line-height: 1.6; }
  .sd-body h2 { font-size: 14px; margin: 18px 0 4px; break-after: avoid; }
  .sd-body h3 { font-size: 12.5px; margin: 14px 0 3px; break-after: avoid; }
  .sd-body h4 { font-size: 11.5px; margin: 12px 0 2px; break-after: avoid; }
  .sd-body p { margin: 0 0 8px; }
  .sd-body ul, .sd-body ol { margin: 0 0 8px; padding-left: 18px; }
  .sd-body li { margin: 0 0 3px; break-inside: avoid; }
  .sd-body a { color: inherit; }
</style>`;

const LABELS = {
  en: { kicker: { POLICY: "Policy", LEGAL: "Legal Notice" }, version: "Version", effective: "Effective", approved: "Approved By" },
  fr: { kicker: { POLICY: "Politique", LEGAL: "Mention légale" }, version: "Version", effective: "En vigueur le", approved: "Approuvée par" },
  de: { kicker: { POLICY: "Richtlinie", LEGAL: "Rechtlicher Hinweis" }, version: "Version", effective: "Gültig ab", approved: "Freigegeben durch" },
};

/**
 * @param {object} doc   { kind, lang, title, summary, body, version_label, effective_on, approved_by }
 * @param {object} cfg   the renderer's resolved letterhead config
 * @param {object} entity the issuing company, as the template service resolved it
 */
function build(doc, cfg, entity) {
  const L = LABELS[doc.lang] || LABELS.en;
  const facts = [
    doc.version_label ? [L.version, doc.version_label] : null,
    doc.effective_on ? [L.effective, k.dateFmt(doc.effective_on)] : null,
    doc.approved_by ? [L.approved, doc.approved_by] : null,
  ].filter(Boolean);
  const body = [
    STYLE(cfg),
    k.standardHead(entity, cfg, {}),
    `<div class="sd-cover">
      <p class="sd-kicker accent">${k.esc((L.kicker[doc.kind] || L.kicker.POLICY))}</p>
      <h1 class="sd-title">${k.esc(doc.title)}</h1>
      ${doc.summary ? `<p class="sd-summary muted">${inline(doc.summary)}</p>` : ""}
    </div>`,
    facts.length
      ? `<div class="sd-facts">${facts.map(([l, v]) =>
        `<div><div class="l muted">${k.esc(l)}</div><div class="v">${k.esc(v)}</div></div>`).join("")}</div>`
      : "",
    `<div class="sd-body">${markdownToHtml(doc.body)}</div>`,
    k.standardFoot(entity, cfg, null),
  ].join("");
  return k.shell(doc.title, body, cfg);
}

module.exports = { build, markdownToHtml, inline };
