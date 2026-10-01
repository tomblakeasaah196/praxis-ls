/**
 * Dictionary siblings on the client — the reader's-language helpers and the
 * batched lookup the picker and its guard share (meeting 6, F2). The rules
 * themselves (modes, wording, preset, mismatch) are @shared dictionarySibling;
 * this file only puts them in the reader's language and fetches.
 */
import * as React from "react";
import { dictionarySibling } from "@shared";
import i18n from "@/lib/i18n";
import { dictLabel } from "@/lib/dict-label";
import {
  dictSiblings,
  type DictSearchHit,
  type DictSiblingInfo,
  type Fulfilment,
  type SiblingMode,
} from "@/lib/masterdata-api";

export const siblingLang = () =>
  i18n.language?.startsWith("fr") ? "fr" : "en";

/** The answer for a mode, in the reader's language. */
export const answerLabel = (mode: SiblingMode | null | undefined) =>
  mode ? dictionarySibling.answerFor(mode, siblingLang()) : "";

/** The service's name without its "— Client Account" suffix. */
export function groupLabel(hit: DictSearchHit): string {
  const fr = siblingLang() === "fr";
  const first = fr ? hit.group_label_fr : hit.group_label_en;
  const second = fr ? hit.group_label_en : hit.group_label_fr;
  return (
    (first && first.trim()) ||
    (second && second.trim()) ||
    dictionarySibling.baseLabel(dictLabel(hit))
  );
}

/** The sibling a document's context presets, or null. */
export function presetSibling(
  fulfilment: Fulfilment | null | undefined,
  siblings: DictSearchHit[],
): DictSearchHit | null {
  return dictionarySibling.presetFor(fulfilment ?? null, siblings);
}

/** The siblings of one dictionary line, fetched once and shared (batched). */
export function useSiblingInfo(
  id: string | null | undefined,
): DictSiblingInfo | null {
  const [info, setInfo] = React.useState<DictSiblingInfo | null>(null);
  React.useEffect(() => {
    let live = true;
    setInfo(null);
    if (!id) return;
    void dictSiblings(id).then((r) => {
      if (live) setInfo(r);
    });
    return () => {
      live = false;
    };
  }, [id]);
  return info;
}
