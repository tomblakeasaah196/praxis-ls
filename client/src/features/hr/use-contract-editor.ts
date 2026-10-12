/**
 * The contract editor's TipTap instance.
 *
 * ── THE EXTENSION LIST IS A CONTRACT WITH `lib/contract-md` ────────────────
 *
 * Every node and mark enabled here has a case in `docToMd`. Enabling one
 * without adding the case does not throw — the serialiser passes an unknown
 * node's children through — it silently drops the FORMATTING, which looks
 * exactly like the editor being buggy. On a document somebody signs, that is
 * the expensive kind of quiet.
 *
 * So the grammar is tiny and closed: the article heading, paragraphs, bullet
 * and ordered lists, bold, italic, and a hard break. Everything StarterKit
 * would otherwise give us is switched OFF below, one line each, because the
 * default is the dangerous direction. `contract-md.test.ts` round-trips the
 * clause library's verbatim output through it, and `contract-clauses.test.js`
 * holds the library to the same grammar from the other side.
 *
 * The mail composer keeps the same discipline with its own serialiser
 * (`comms/inbox/composer/use-editor.ts`); this is that pattern, with a
 * narrower grammar because a contract is not an email.
 *
 * ── WHY THE HOOK IS ITS OWN MODULE ─────────────────────────────────────────
 *
 * A module exporting both a hook and a component loses fast refresh, so
 * editing the toolbar would remount the editor and drop the caret on every
 * save. Same split, same reason, as the composer.
 */
import * as React from "react";
import { useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { tr } from "@/lib/i18n";
import { mdToDoc, docToMd, ARTICLE_LEVEL } from "@/lib/contract-md";

export function useContractEditor({
  initialMd,
  editable = true,
  onChange,
}: {
  /** Read ONCE, at mount. Key the component by contract id to switch records —
   *  feeding this on every keystroke is the classic controlled-editor mistake
   *  and it loses the caret. */
  initialMd: string | null | undefined;
  editable?: boolean;
  /** The body as markdown, which is what the column stores and what the PDF
   *  renderer splits on. The caller never sees the document model. */
  onChange?: (md: string) => void;
}): Editor | null {
  const changeRef = React.useRef(onChange);
  changeRef.current = onChange;

  return useEditor(
    {
      editable,
      extensions: [
        StarterKit.configure({
          // The ONE heading a contract has. An `###` inside a clause would
          // render as a heading here and print as a line of hashes there,
          // because the PDF splits on `##` and nothing else.
          heading: { levels: [ARTICLE_LEVEL] },
          // Off, each for the same reason: `docToMd` cannot carry it, and the
          // PDF template has no treatment for it either.
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
          code: false,
          strike: false,
        }),
        Placeholder.configure({
          placeholder: tr("Draft with AI, or write the contract here."),
        }),
      ],
      content: mdToDoc(initialMd),
      onUpdate: ({ editor }) => changeRef.current?.(docToMd(editor.getJSON())),
      editorProps: {
        attributes: {
          class: "prose prose-sm dark:prose-invert max-w-none px-4 py-3 focus:outline-none",
          // A contenteditable with no role is a black hole to a screen reader.
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": tr("Contract text"),
        },
      },
    },
    // Built once. The caller remounts by key when the contract changes.
    [],
  );
}

export type { Editor, JSONContent };
