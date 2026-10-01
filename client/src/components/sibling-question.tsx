/**
 * "How is this charged on this file?" — one service, several fulfilment modes.
 *
 * WHY IT EXISTS. Meeting 6 (29 Sep 2026), register 3.2 / owner decision F2.
 * The dictionary carries one row per way a service is delivered — "Gate-Pass
 * Fee" paid as our own cost (an expense) and "Gate-Pass Fee — Client Account"
 * advanced for the client (a débours, re-billed at cost) — because the way
 * decides the account. Every picker listed both, nothing said which to choose,
 * and the own-cost row on a client-billed costing posts to the wrong account.
 *
 * So a picker shows the service ONCE and asks this one plain question. Each
 * answer is a real dictionary row (`siblings`, linked by 14342); choosing one
 * hands that row to the caller exactly as if it had been searched for. The
 * answer the document's context points at (`preset`) is marked "Suggested for
 * this file" and takes focus, so Enter accepts it.
 *
 * The wording and the mode table live in @shared dictionarySibling — the API
 * stamps the same modes, so the two cannot disagree about what "billed" means.
 *
 * <SiblingGuard> is the other half: a saved or picked line that contradicts
 * its document (our own cost on a line the client is billed for, a débours on
 * our own purchase) gets one sentence saying why and a one-tap switch.
 */
import * as React from "react";
import { dictionarySibling } from "@shared";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { dictLabel } from "@/lib/dict-label";
import {
  answerLabel,
  presetSibling,
  siblingLang as lang,
  useSiblingInfo,
} from "@/lib/dictionary-sibling";
import type {
  DictSearchHit,
  Fulfilment,
  SiblingMode,
} from "@/lib/masterdata-api";

export function SiblingQuestion({
  service,
  siblings,
  fulfilment,
  onChoose,
  onBack,
}: {
  /** The display name of the service (without the sibling suffix). */
  service: string;
  siblings: DictSearchHit[];
  fulfilment?: Fulfilment | null;
  onChoose: (sibling: DictSearchHit) => void;
  onBack?: () => void;
}) {
  const ordered = dictionarySibling.orderSiblings(siblings);
  const preset = presetSibling(fulfilment, ordered);
  const presetRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    requestAnimationFrame(() => presetRef.current?.focus());
  }, []);

  return (
    <div
      className="space-y-2 p-3"
      role="group"
      aria-label={tr(dictionarySibling.QUESTION.en)}
    >
      <div>
        <p className="text-sm font-medium text-foreground">{service}</p>
        <p className="text-xs text-muted-foreground">
          {lang() === "fr"
            ? dictionarySibling.QUESTION.fr
            : dictionarySibling.QUESTION.en}
        </p>
      </div>
      <div className="space-y-1">
        {ordered.map((s) => {
          const mode = (s.mode ??
            dictionarySibling.modeOf(s.direction)) as SiblingMode;
          const isPreset = preset?.dictionary_item_id === s.dictionary_item_id;
          return (
            <button
              key={s.dictionary_item_id}
              ref={isPreset ? presetRef : undefined}
              type="button"
              onClick={() => onChoose(s)}
              className={cn(
                "flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isPreset ? "border-primary bg-primary/10" : "",
              )}
            >
              <span className="text-sm text-foreground">
                {answerLabel(mode)}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{s.code}</span>
                <span className="min-w-0 truncate">{dictLabel(s)}</span>
                {isPreset && (
                  <span className="ml-auto shrink-0 text-primary-ink">
                    {tr("Suggested for this file")}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {onBack && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={onBack}>
            {tr("Back")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The guard (F2): a line whose fulfilment mode contradicts its document is
 * flagged before the save — one sentence and a one-tap switch to the sibling
 * that fits. Says nothing when the line agrees, when the document has no
 * context, or when the service has no other mode to switch to.
 */
export function SiblingGuard({
  value,
  fulfilment,
  onSwitch,
  className,
}: {
  value: string | null | undefined;
  fulfilment: Fulfilment | null | undefined;
  onSwitch: (to: DictSearchHit) => void;
  className?: string;
}) {
  const info = useSiblingInfo(fulfilment ? value : null);
  if (!info || !fulfilment) return null;
  const m = dictionarySibling.mismatch(
    fulfilment,
    info.direction,
    info.siblings,
  );
  if (!m) return null;
  return (
    <div
      role="status"
      className={cn(
        "mt-1 flex flex-wrap items-center gap-2 rounded-md border border-warn/35 bg-warn-fill/[0.06] px-2 py-1 text-xs text-foreground",
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        {lang() === "fr" ? m.reason.fr : m.reason.en}
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onSwitch(m.to as DictSearchHit)}
      >
        {tr("Switch to")}: {answerLabel(m.to_mode)}
      </Button>
    </div>
  );
}
