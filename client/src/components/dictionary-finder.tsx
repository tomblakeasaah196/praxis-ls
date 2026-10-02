/**
 * Dictionary Finder (MOD-05) — the one control for choosing a financial
 * dictionary line, used from costing, quotation, cash request, purchase order,
 * supplier invoice and the dictionary itself.
 *
 * WHY IT EXISTS. The catalogue is 176 lines and nobody outside finance knows
 * what it calls things. An operations clerk looking at a carrier invoice sees
 * "surestaries"; the catalogue says Demurrage. A driver's paperwork says
 * "gasoil"; the catalogue says Fuel. A filed costing sheet says "#-1119"; that
 * code was retired at the migration. A native `<select>` over 176 options
 * answers none of those, so people pick the nearest-looking line and the
 * costing is wrong in a way nobody notices until the month-end.
 *
 * So the search is server-side and fuzzy (GET /financial-dictionary/search):
 * exact keyword hits first — the alternates, abbreviations, misspellings and
 * superseded codes seeded in 9081 — then code matches, then trigram similarity
 * over both labels and the description. Typing "demurage" with one r finds it.
 *
 * WHAT IT SHOWS, AND WHY. Each row carries the code, both labels, and the
 * direction as a badge. The direction is the part people get wrong: a DÉBOURS
 * line is money advanced for the client and re-billed at cost, a REVENUE line
 * is the company's own fee. Choosing between "Customs Clearance" (your fee) and
 * "Customs Duties & Taxes" (the client's money) is exactly the mistake this
 * badge is here to prevent, so it is on the row and not behind a tooltip.
 *
 * The description sits under the name because that is what disambiguates two
 * lines whose names look alike — and it is the field the fuzzy search matches
 * on, so the reason a row came back is visible.
 *
 * THE EQUIPMENT STEP. Some charges are priced per container type (0632's
 * `varies_by_equipment`), and until 0663 the document never recorded which box
 * it had bought. Rather than build that into each of the six forms that use
 * this control — six near-identical implementations, five of which would drift
 * — a caller opts in by passing `onPickMulti`, and picking a flagged charge
 * reveals the equipment step before returning. Callers that do not pass it are
 * untouched: same one-argument flow, same close-on-pick.
 *
 * ONE SERVICE, ONE ROW (meeting 6, F2). A service the catalogue holds in
 * several fulfilment modes — "Gate-Pass Fee" (our own cost) and "Gate-Pass Fee
 * — Client Account" (débours) — comes back from the search ONCE, with its
 * modes in `siblings`. Picking it asks one plain question (<SiblingQuestion>),
 * preset from the caller's `fulfilment`, and the answer is the row handed back.
 * With `fulfilment` set, the trigger also carries the guard: a line whose mode
 * contradicts the document is flagged with a one-tap switch. The service-type
 * mapping screen maps every row and passes `groupSiblings={false}`.
 */
import { dictLabel } from "@/lib/dict-label";
import * as React from "react";
import { Popover } from "@/components/ui/popover";
import { Pill, type Tone } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { EquipmentStep, type EquipmentPick } from "@/components/equipment-step";
import { SiblingGuard, SiblingQuestion } from "@/components/sibling-question";
import { groupLabel } from "@/lib/dictionary-sibling";
import { tr } from "@/lib/i18n";
import {
  searchDict,
  type DictSearchHit,
  type Direction,
  type Fulfilment,
} from "@/lib/masterdata-api";

/**
 * Direction → the shared status tones. Disbursement is `warn` deliberately: it is the
 * one a picker most needs to catch the eye, because choosing it commits the line
 * to being re-billed at cost with no VAT of ours, and choosing revenue by
 * mistake books the client's money as turnover.
 */
const DIRECTION_TONE: Record<Direction, { label: string; tone: Tone }> = {
  REVENUE: { label: "Revenue", tone: "ok" },
  DISBURSEMENT: { label: "Disbursement", tone: "warn" },
  EXPENSE: { label: "Expense", tone: "blue" },
  ASSET: { label: "Asset", tone: "orange" },
};

// In the reader's language — see lib/dict-label.
const labelOf = (h: {
  label_en?: string | null;
  label_fr?: string | null;
  code: string;
}) => dictLabel(h);

export function DictionaryFinder({
  value,
  valueLabel,
  onPick,
  label = "Financial dictionary line",
  placeholder = "Search a charge…",
  direction,
  serviceTypeId,
  id,
  allowEmpty = true,
  dossierId,
  onPickMulti,
  fulfilment,
  groupSiblings = true,
  onSwitchSibling,
}: {
  value?: string | null;
  /** Display snapshot for the current value, so the trigger reads correctly
   *  before any search has run (the caller already stores a denormalised label). */
  valueLabel?: string | null;
  onPick: (id: string, label: string, hit?: DictSearchHit) => void;
  label?: string;
  placeholder?: string;
  /** Narrow to one direction — a cash request only ever advances débours. */
  direction?: Direction;
  /** Narrow to the lines mapped to a service type (the dossier's service). */
  serviceTypeId?: string | null;
  id?: string;
  allowEmpty?: boolean;
  /** Dossier whose containers pre-fill the equipment step. Omit outside dossier
   *  context (purchase orders, requests) — the step then lists all active types
   *  with no pre-selection. Ignored without `onPickMulti`. */
  dossierId?: string | null;
  /** Opts this finder into the equipment step, and receives the result: one
   *  entry per container type chosen, for the caller to expand into lines. Not
   *  passing it keeps the plain single-pick behaviour exactly as it was. */
  onPickMulti?: (
    id: string,
    label: string,
    hit: DictSearchHit,
    picks: EquipmentPick[],
  ) => void;
  /** Who this document charges (F2): "billed" presets the débours row and
   *  flags our own cost; "own" presets our own cost and flags a débours. */
  fulfilment?: Fulfilment | null;
  /** false lists every fulfilment mode as its own row (service-type mapping). */
  groupSiblings?: boolean;
  /** The guard's one-tap switch. Defaults to `onPick`; a caller that keeps
   *  the line's quantity and container type on a switch passes its own. */
  onSwitchSibling?: (hit: DictSearchHit) => void;
}) {
  const [open, setOpen] = React.useState(false);
  // The service whose fulfilment mode is being asked. Non-null == the popover
  // shows the question rather than the results.
  const [asking, setAsking] = React.useState<{
    hit: DictSearchHit;
    withEquipment: boolean;
  } | null>(null);
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<DictSearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  // The charge whose equipment is being chosen. Non-null == the popover is
  // showing the second step rather than the search results.
  const [pending, setPending] = React.useState<DictSearchHit | null>(null);
  const [picks, setPicks] = React.useState<EquipmentPick[]>([]);
  const searchRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open && !pending && !asking)
      requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, pending, asking]);

  // Debounced, and every in-flight response is checked against the current term
  // before it is rendered — otherwise a slow "de" lands after a fast "demurage"
  // and overwrites the right answer with a stale one.
  React.useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      searchDict({
        q: term,
        direction,
        service_type_id: serviceTypeId || undefined,
        limit: 20,
        group: groupSiblings,
      })
        .then((rows) => {
          if (!cancelled) setHits(rows);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open, direction, serviceTypeId, groupSiblings]);

  const close = () => {
    setOpen(false);
    setQ("");
    setPending(null);
    setAsking(null);
    setPicks([]);
  };

  /** `withEquipment` forces the second step for a charge the catalogue does not
   *  flag — the escape hatch. Reality disagrees with the flag often enough
   *  (a one-off per-box surcharge on an item normally priced per BL) that
   *  refusing to record equipment there would send people back to typing the
   *  container into the label. */
  const pick = (hit: DictSearchHit | null, withEquipment = false) => {
    // A service in several modes: ask which one first (F2). The answer comes
    // back through `choose`, which continues exactly as a direct pick would.
    if (hit && groupSiblings && (hit.siblings?.length ?? 0) > 1) {
      setAsking({ hit, withEquipment });
      return;
    }
    proceed(hit, withEquipment);
  };

  const choose = (sibling: DictSearchHit) => {
    const withEquipment = asking?.withEquipment ?? false;
    setAsking(null);
    proceed(sibling, withEquipment);
  };

  const proceed = (hit: DictSearchHit | null, withEquipment = false) => {
    if (hit && onPickMulti && (withEquipment || hit.varies_by_equipment)) {
      setPicks([]);
      setPending(hit);
      return;
    }
    if (hit) onPick(hit.dictionary_item_id, labelOf(hit), hit);
    else onPick("", "");
    close();
  };

  const confirmEquipment = () => {
    if (!pending) return;
    onPickMulti?.(pending.dictionary_item_id, labelOf(pending), pending, picks);
    close();
  };

  const term = q.trim();

  return (
    <div className="min-w-0">
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) close();
        }}
        align="start"
        label={label}
        className="w-[min(30rem,92vw)] p-0"
        trigger={
          <button
            type="button"
            id={id}
            aria-label={label}
            className="flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 truncate">
              {value && valueLabel ? (
                valueLabel
              ) : (
                <span className="text-muted-foreground">{placeholder}</span>
              )}
            </span>
            <span aria-hidden className="text-muted-foreground">
              ▾
            </span>
          </button>
        }
      >
        {asking ? (
          <SiblingQuestion
            service={groupLabel(asking.hit)}
            siblings={asking.hit.siblings || []}
            fulfilment={fulfilment}
            onChoose={choose}
            onBack={() => setAsking(null)}
          />
        ) : pending ? (
          <EquipmentStep
            dossierId={dossierId}
            itemLabel={labelOf(pending)}
            value={picks}
            onChange={setPicks}
            onBack={() => setPending(null)}
            onConfirm={confirmEquipment}
          />
        ) : (
          <>
            <div className="border-b p-2">
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Type a charge, a code, or what it is called locally…"
                aria-label={label}
                className="h-8 w-full rounded-md border bg-transparent px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div
              className="max-h-72 overflow-auto p-1"
              role="listbox"
              aria-label={label}
            >
              {allowEmpty && (
                <button
                  type="button"
                  onClick={() => pick(null)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
                >
                  — None
                </button>
              )}
              {term.length < 2 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Type at least two characters. Local names work too —
                  “surestaries”, “gasoil”, “THC”.
                </div>
              ) : loading ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  Searching…
                </div>
              ) : hits.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No line matches “{term}”.
                </div>
              ) : (
                hits.map((h) => {
                  const badge =
                    DIRECTION_TONE[h.direction] || DIRECTION_TONE.EXPENSE;
                  // One row for a service in several modes: its name without the
                  // suffix, and a pill saying the next step asks how it is charged.
                  const grouped =
                    groupSiblings && (h.siblings?.length ?? 0) > 1;
                  // The escape hatch (one per row, because it needs to know WHICH
                  // charge): a charge the catalogue does not flag can still be priced
                  // per box on this particular file. Only offered to callers that can
                  // receive the result. A presentational wrapper keeps the option a
                  // direct child of the listbox for assistive tech.
                  const hatch = !!onPickMulti && !h.varies_by_equipment;
                  return (
                    <div
                      key={h.dictionary_item_id}
                      role="presentation"
                      className="flex items-stretch gap-1"
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={h.dictionary_item_id === value}
                        onClick={() => pick(h)}
                        className={cn(
                          "flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted",
                          h.dictionary_item_id === value ? "bg-primary/10" : "",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {grouped
                              ? (h.siblings || [])
                                  .map((x) => x.code)
                                  .join(" · ")
                              : h.code}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {grouped ? groupLabel(h) : labelOf(h)}
                          </span>
                          {/* Flagged before the click, not after: the second step is
                        less of a surprise when the row said it was coming. */}
                          {onPickMulti && h.varies_by_equipment && (
                            <Pill tone="blue">Varies by container type</Pill>
                          )}
                          {grouped ? (
                            <Pill tone="warn">{tr("Billed or own cost")}</Pill>
                          ) : (
                            <Pill tone={badge.tone}>{badge.label}</Pill>
                          )}
                        </span>
                        {h.description && (
                          <span className="line-clamp-2 text-xs text-muted-foreground">
                            {h.description}
                          </span>
                        )}
                      </button>
                      {hatch && (
                        <button
                          type="button"
                          onClick={() => pick(h, true)}
                          title="Price this charge per container type"
                          className="shrink-0 self-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          + Equipment
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </Popover>
      {fulfilment && (
        <SiblingGuard
          value={value}
          fulfilment={fulfilment}
          onSwitch={(to) =>
            onSwitchSibling
              ? onSwitchSibling(to)
              : onPick(to.dictionary_item_id, labelOf(to), to)
          }
        />
      )}
    </div>
  );
}
