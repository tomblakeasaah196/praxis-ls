/**
 * The formatting toolbar.
 *
 * ── SIX BUTTONS ─────────────────────────────────────────────────────────────
 *
 * Bold, italic, underline, the two lists and a link. This bar used to carry
 * about twenty controls: strikethrough, heading, quote, code, table, rule,
 * image by address, three alignments, text colour, highlight, a font menu and
 * clear formatting. The tenant review of 16 Nov 2026 asked for the basics and
 * nothing else, and an email is written with these six.
 *
 * Nothing was taken out of the EDITOR. The extensions are all still loaded in
 * `use-editor.ts` and `compose.js` still serializes every one of them, so a
 * reply that quotes a table, a pasted heading and Ctrl+Shift+X all behave as
 * before. What left is the buttons.
 *
 * ── EVERY CONTROL IS A BUTTON WITH aria-pressed ─────────────────────────────
 *
 * A toolbar built from divs with click handlers is the most common
 * mouse-only-by-construction control on the web, and a formatting toolbar is
 * exactly where a keyboard user needs to be able to tell what is currently ON.
 * `aria-pressed` reflects the mark at the caret, so a screen reader announces
 * "Bold, pressed" rather than just "Bold".
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";
import { type Editor } from "./use-editor";
import { usePrompt } from "@/components/ui/use-prompt";

function Tool({
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      // onMouseDown, not onClick: clicking a toolbar button blurs the editor and
      // the selection is lost before the command runs.
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-sm transition-colors",
        active ? "bg-primary/15 font-semibold text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />;

export function ComposerToolbar({
  editor,
  slotRight,
}: {
  editor: Editor | null;
  /** The right-hand end of the bar: the composer's one AI button sits here. */
  slotRight?: React.ReactNode;
}) {
  // TipTap mutates the editor in place, so React has nothing to re-render on.
  // Subscribing to its transactions is what keeps aria-pressed honest.
  const [prompt, promptDialog] = usePrompt();
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!editor) return undefined;
    editor.on("transaction", force);
    return () => { editor.off("transaction", force); };
  }, [editor]);

  if (!editor) return null;
  const chain = () => editor.chain().focus();

  return (
    <>
    {promptDialog}
    <div
      role="toolbar"
      aria-label={tr("Formatting")}
      aria-controls="composer-body"
      className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1"
    >
      <Tool label={tr("Bold")} active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}>
        <strong>B</strong>
      </Tool>
      <Tool label={tr("Italic")} active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}>
        <em>I</em>
      </Tool>
      <Tool label={tr("Underline")} active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}>
        <span className="underline">U</span>
      </Tool>

      <Divider />

      <Tool label={tr("Bulleted list")} active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}>
        •
      </Tool>
      <Tool label={tr("Numbered list")} active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}>
        1.
      </Tool>

      <Divider />

      <Tool
        label={tr("Link")}
        active={editor.isActive("link")}
        onClick={() => {
          if (editor.isActive("link")) { chain().unsetLink().run(); return; }
          /*
           * This was a `window.prompt`, with a comment explaining that the caret
           * and selection had to survive and that every dialog in the app moves
           * focus.
           *
           * The concern was right; the conclusion no longer holds. `chain()` is
           * `editor.chain().focus()`, and TipTap re-applies the STORED selection
           * when focus returns — which is why every other control on this
           * toolbar works, since clicking any toolbar button already blurs the
           * editor. The dialog additionally restores focus to its opener (this
           * button) on close, so the editor is refocused from the same place
           * Bold refocuses it from.
           */
          void (async () => {
            const url = await prompt({
              title: tr("Add a Link"),
              label: tr("Link To"),
              type: "url",
              placeholder: "https://",
              hint: tr("The selected text becomes the link."),
              confirmLabel: tr("Add link"),
              validate: (v) =>
                /^(https?:\/\/|mailto:)/i.test(v.trim())
                  ? null
                  : tr("Start with https:// or mailto:"),
            });
            if (url) chain().setLink({ href: url }).run();
          })();
        }}
      >
        🔗
      </Tool>

      <span className="ml-auto flex items-center gap-1">{slotRight}</span>
    </div>
    </>
  );
}
