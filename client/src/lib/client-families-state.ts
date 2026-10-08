/**
 * The state behind the client families (tenant review, meeting 6 — G2): the
 * CLIENT_HEADING registry, moving lines, a made-up family, the ticked lines,
 * and the polite announcer every move speaks through.
 *
 * Hooks and helpers only, so `components/client-families.tsx` exports nothing
 * but components (react-refresh: a module that mixes the two loses fast
 * refresh). The screens import these from here and the views from there.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { usePrompt } from "@/components/ui/use-prompt";
import { useResource } from "@/lib/use-resource";
import { listDictRefs } from "@/lib/masterdata-api";
import { resolveHeading, type HeadedLine, type HeadingRef } from "@/lib/client-headings";

/** The CLIENT_HEADING registry — the families a document can print. */
export function useFamilyRegistry(): HeadingRef[] {
  const refs = useResource(() => listDictRefs("CLIENT_HEADING"), []);
  return React.useMemo(() => refs.data || [], [refs.data]);
}

/** Families made up on this document, offered on every line so a second line
 *  can join the first without retyping it. */
export function customFamilies(lines: HeadedLine[], registry: HeadingRef[]): string[] {
  return [
    ...new Set(
      lines
        .map((l) => resolveHeading(l, registry))
        .filter((h) => h.custom)
        .map((h) => h.en),
    ),
  ];
}

/** `lines` with the lines at `indices` moved to `heading` (null = the catalogue's). */
export function moveLines<T extends HeadedLine>(lines: T[], indices: Iterable<number>, heading: string | null): T[] {
  const at = new Set(indices);
  return lines.map((l, i) => (at.has(i) ? { ...l, client_heading: heading } : l));
}

/** "New heading…" — a family made up for this document. */
export function useNewFamily(): [() => Promise<string | null>, React.ReactNode] {
  const [prompt, dialog] = usePrompt();
  const ask = React.useCallback(
    async () =>
      (await prompt({
        title: tr("New family for this document"),
        label: tr("Heading the Client Reads"),
        hint: tr("For example: DAP Douala–Bangui. It applies to this document only."),
        validate: (v) => (v.trim().length < 2 ? tr("At least two characters.") : null),
        confirmLabel: tr("Use this heading"),
      })) || null,
    [prompt],
  );
  return [ask, dialog];
}

/**
 * A selection of lines, by index, held by the screen so the detailed view and
 * the By-family view tick the same lines. Cleared when the line count changes —
 * an index that now names a different line is worse than an empty selection.
 */
export function useLineSelection(count: number) {
  const [selected, setSelected] = React.useState<ReadonlySet<number>>(() => new Set());
  React.useEffect(() => setSelected(new Set()), [count]);
  const toggle = React.useCallback((i: number) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  }, []);
  const setMany = React.useCallback((indices: number[], on: boolean) => {
    setSelected((s) => {
      const n = new Set(s);
      for (const i of indices) {
        if (on) n.add(i);
        else n.delete(i);
      }
      return n;
    });
  }, []);
  const clear = React.useCallback(() => setSelected(new Set()), []);
  return { selected, toggle, setMany, clear };
}
export type LineSelection = ReturnType<typeof useLineSelection>;

/** A move is announced however it was made — drag, picker or bulk bar. */
export function useAnnouncer(): [(text: string) => void, React.ReactNode] {
  const [text, setText] = React.useState("");
  const say = React.useCallback((t: string) => {
    // Cleared first so the same sentence twice is still read twice.
    setText("");
    window.setTimeout(() => setText(t), 30);
  }, []);
  const node = React.createElement("p", { className: "sr-only", "aria-live": "polite", role: "status" }, text);
  return [say, node];
}
