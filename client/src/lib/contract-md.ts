/**
 * The contract body, between the editor's document and the stored markdown.
 *
 * ── WHY A ROUND TRIP AND NOT JUST A RICH TEXT FIELD ────────────────────────
 *
 * `hr_contract.body_md` is markdown and has to stay markdown. Three things
 * downstream read it that way and none of them is negotiable:
 *
 *   · `template.service.contractArticles` SPLITS ON `##` to produce the
 *     articles the PDF prints. A heading that does not survive the trip is an
 *     article that silently merges into the one above it.
 *   · `hr_contract.clauses` GENERATES this markdown, so whatever the editor
 *     writes has to be the same shape the library writes.
 *   · the signature payload maps clause headings into what a holder verifies.
 *
 * So the editor is a VIEW of the markdown, not a replacement for it, and this
 * module is the only place the two meet. Both directions live here so they
 * cannot drift into disagreeing: `contract-md.test.ts` round-trips every clause
 * the library emits, in both languages, and fails if one character moves.
 *
 * ── THE GRAMMAR IS DELIBERATELY TINY ───────────────────────────────────────
 *
 * Heading (one level), paragraph, bullet list, ordered list, bold, italic, and
 * a hard break inside a paragraph. That is everything the clause library emits
 * and everything `components/markdown.tsx` renders.
 *
 * Nothing else is offered BY THE EDITOR either (see contract-text-editor), and
 * that is the point rather than a limitation. A toolbar button whose output
 * this module cannot serialise produces formatting that vanishes on save —
 * which looks exactly like the editor being broken, on the one document where
 * losing a line matters most. The editor's extension list and this grammar move
 * together, the same contract the mail composer's serializer keeps with
 * `use-editor.ts`.
 *
 * Tables, images, code blocks, block quotes, rules and heading levels other
 * than the article heading are all OFF. If a contract ever needs a table, it
 * needs it in the PDF template first, and then here.
 */
import type { JSONContent } from "@tiptap/react";

/** The one heading level a contract has: the article. */
export const ARTICLE_LEVEL = 2 as const;

/* ── markdown → document ──────────────────────────────────────────────────*/

/** `**bold**`, `*italic*` / `_italic_`, and the text between them. */
function inlineToNodes(text: string): JSONContent[] {
  const out: JSONContent[] = [];
  // One scanner, earliest match wins, the same shape `renderInline` in
  // components/markdown.tsx uses — so what the preview shows and what the
  // editor shows cannot disagree about where a bold run starts.
  const pattern = /(\*\*[^*]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)/;
  let rest = text;
  while (rest.length) {
    const m = pattern.exec(rest);
    if (!m) {
      out.push({ type: "text", text: rest });
      break;
    }
    if (m.index > 0) out.push({ type: "text", text: rest.slice(0, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push({ type: "text", text: tok.slice(2, -2), marks: [{ type: "bold" }] });
    } else {
      out.push({ type: "text", text: tok.slice(1, -1), marks: [{ type: "italic" }] });
    }
    rest = rest.slice(m.index + tok.length);
  }
  // An empty paragraph is a node with no content, never a node with an empty
  // text child — ProseMirror rejects the second and the editor fails to mount.
  return out.filter((n) => n.text !== "");
}

/** A paragraph, with single newlines inside it kept as hard breaks. */
function paragraph(block: string): JSONContent {
  const lines = block.split("\n");
  const content: JSONContent[] = [];
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: "hardBreak" });
    content.push(...inlineToNodes(line));
  });
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

const BULLET = /^[-*]\s+/;
const ORDERED = /^\d+[.)]\s+/;

/** A run of list lines into one list node. */
function list(lines: string[], ordered: boolean): JSONContent {
  return {
    type: ordered ? "orderedList" : "bulletList",
    content: lines.map((line) => ({
      type: "listItem",
      content: [paragraph(line.replace(ordered ? ORDERED : BULLET, ""))],
    })),
  };
}

/**
 * Stored markdown to the editor's document.
 *
 * Blank-line separated blocks, each one a heading, a list or a paragraph. An
 * empty body gives a document with one empty paragraph rather than an empty
 * document, because ProseMirror will not mount the latter.
 */
export function mdToDoc(md: string | null | undefined): JSONContent {
  const text = String(md || "").replace(/\r\n/g, "\n").trim();
  if (!text) return { type: "doc", content: [{ type: "paragraph" }] };

  const content: JSONContent[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading && !trimmed.includes("\n")) {
      content.push({
        type: "heading",
        attrs: { level: ARTICLE_LEVEL },
        content: inlineToNodes(heading[1].trim()),
      });
      continue;
    }

    const lines = trimmed.split("\n");
    if (lines.every((l) => BULLET.test(l))) {
      content.push(list(lines, false));
      continue;
    }
    if (lines.every((l) => ORDERED.test(l))) {
      content.push(list(lines, true));
      continue;
    }
    content.push(paragraph(trimmed));
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/* ── document → markdown ──────────────────────────────────────────────────*/

/** A text node with its marks put back as markdown. */
function inlineToMd(node: JSONContent): string {
  if (node.type === "hardBreak") return "\n";
  let text = node.text || "";
  if (!text) return "";
  const marks = (node.marks || []).map((m) => m.type);
  // Bold outside italic, so `***x***` is never produced in an order the inline
  // scanner above cannot read back.
  if (marks.includes("italic")) text = `*${text}*`;
  if (marks.includes("bold")) text = `**${text}**`;
  return text;
}

const inlineRun = (content: JSONContent[] | undefined) =>
  (content || []).map(inlineToMd).join("");

/**
 * The editor's document back to stored markdown.
 *
 * An unknown node passes its children through rather than being dropped: the
 * failure mode of a node this does not know is then plain text in the contract,
 * which is recoverable, instead of a clause that disappears on save.
 */
export function docToMd(doc: JSONContent | null | undefined): string {
  const blocks: string[] = [];

  const walk = (node: JSONContent): void => {
    switch (node.type) {
      case "heading":
        blocks.push(`## ${inlineRun(node.content)}`.trimEnd());
        return;
      case "paragraph": {
        const text = inlineRun(node.content).trimEnd();
        // A deliberately empty paragraph is spacing the author added; it is
        // already expressed by the blank line between blocks, so it is dropped
        // rather than written out as a block of nothing.
        if (text) blocks.push(text);
        return;
      }
      case "bulletList":
      case "orderedList": {
        const ordered = node.type === "orderedList";
        const items = (node.content || []).map((item, i) => {
          const body = (item.content || []).map((p) => inlineRun(p.content).trimEnd()).filter(Boolean).join(" ");
          return `${ordered ? `${i + 1}.` : "-"} ${body}`;
        });
        if (items.length) blocks.push(items.join("\n"));
        return;
      }
      default:
        (node.content || []).forEach(walk);
    }
  };

  (doc?.content || []).forEach(walk);
  return blocks.join("\n\n");
}

/** True when the document holds nothing a reader would see. */
export const isEmptyDoc = (doc: JSONContent | null | undefined) => docToMd(doc).trim() === "";
