/**
 * The contract text, as an editor rather than a markdown box.
 *
 * ── WHAT THIS REPLACES, AND WHY ────────────────────────────────────────────
 *
 * A `<textarea>` whose placeholder had to teach the user that `##` starts an
 * article. That is the storage format leaking into the one screen where the
 * reader is an HR officer drafting a document somebody will sign, and it was
 * doing it from inside a 512px dialog where the placeholder wrapped two words
 * to a line.
 *
 * Markdown has not gone anywhere — `body_md` is still what is stored and still
 * what the PDF splits on. It is just no longer the user's problem.
 * `lib/contract-md` is the only place the two meet.
 *
 * ── THE TOOLBAR OFFERS EXACTLY WHAT THE GRAMMAR CARRIES ────────────────────
 *
 * Five controls, and there is no sixth hiding in a menu. A button whose output
 * `docToMd` cannot serialise produces formatting that disappears on save, so
 * the toolbar, the extension list in `use-contract-editor` and the grammar in
 * `contract-md` are one decision made in three files, with a test on each side.
 */
import * as React from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { ARTICLE_LEVEL } from "@/lib/contract-md";

/** House icon shape: 24-unit box, current colour, 1.8 stroke. */
const Icon = ({ d, children }: { d?: string; children?: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor"
       strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d ? <path d={d} /> : children}
  </svg>
);

const BulletIcon = () => (
  <Icon>
    <circle cx="4" cy="7" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="4" cy="17" r="1.4" fill="currentColor" stroke="none" />
    <path d="M9 7h11M9 12h11M9 17h11" />
  </Icon>
);

const NumberIcon = () => (
  <Icon>
    <path d="M9 7h11M9 12h11M9 17h11" />
    <path d="M3.2 5.6 4.4 5v3.4M3 16.2c0-.7.6-1.2 1.3-1.2.6 0 1.1.4 1.1 1 0 .9-2.4 1.4-2.4 2.8h2.6" />
  </Icon>
);

/**
 * One toolbar control.
 *
 * `aria-pressed` rather than a class alone: a toggle whose only state is a
 * background colour tells a screen-reader user nothing about whether the
 * caret is already inside a bold run.
 */
function Tool({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // The editor loses its selection to a focus change, so the press must
      // not move focus out of the document before the command runs.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={!!active}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-8 min-w-8 place-items-center rounded-md px-2 text-sm transition-colors",
        "text-muted-foreground hover:bg-accent hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-40",
        active && "bg-accent text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ContractTextEditor({
  editor,
  readOnly,
}: {
  editor: Editor | null;
  readOnly?: boolean;
}) {
  /* TipTap mutates the editor outside React, so `editor.isActive(...)` read
     during render is stale by a keystroke. Subscribing to its own transaction
     stream is what keeps the pressed states honest. */
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!editor) return undefined;
    editor.on("transaction", bump);
    return () => {
      editor.off("transaction", bump);
    };
  }, [editor]);

  const can = !!editor && !readOnly;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background">
      {!readOnly && (
        <div
          role="toolbar"
          aria-label={tr("Formatting")}
          aria-orientation="horizontal"
          className="flex flex-wrap items-center gap-1 border-b bg-muted/30 px-2 py-1.5"
        >
          <Tool
            label={tr("Article Heading")}
            active={editor?.isActive("heading", { level: ARTICLE_LEVEL })}
            disabled={!can}
            onClick={() => editor?.chain().focus().toggleHeading({ level: ARTICLE_LEVEL }).run()}
          >
            {/* Named, not an icon: this is the one control whose meaning is
                specific to this document. Every heading is an article, and
                the printed contract numbers them from these. */}
            <span className="px-0.5 text-xs font-semibold">{tr("Article")}</span>
          </Tool>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <Tool
            label={tr("Bold")}
            active={editor?.isActive("bold")}
            disabled={!can}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <span className="font-bold">B</span>
          </Tool>
          <Tool
            label={tr("Italic")}
            active={editor?.isActive("italic")}
            disabled={!can}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <span className="font-serif italic">I</span>
          </Tool>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <Tool
            label={tr("Bulleted List")}
            active={editor?.isActive("bulletList")}
            disabled={!can}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <BulletIcon />
          </Tool>
          <Tool
            label={tr("Numbered List")}
            active={editor?.isActive("orderedList")}
            disabled={!can}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <NumberIcon />
          </Tool>
          <span className="ml-auto" />
          <Tool label={tr("Undo")} disabled={!can || !editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}>
            <Icon d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
          </Tool>
          <Tool label={tr("Redo")} disabled={!can || !editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}>
            <Icon d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />
          </Tool>
        </div>
      )}
      {/* The document scrolls, the toolbar does not. A four-page contract in a
          pane that grows the page is the thing that made the old dialog
          unusable. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
