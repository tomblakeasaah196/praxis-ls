/**
 * THE "BY FAMILY" VIEW — what a client will read, next to what we costed.
 *
 * Tenant review "meeting 5" (21 Sep 2026, 01:28:21): the costing breaks
 * "Customs Formalities 500 000" into six lines — duties, the clearance fee,
 * the officers' transport, a gate pass… — and the quotation and invoice must
 * show the client the one line. This view groups the detailed lines exactly as
 * those documents print them (lib/client-headings.ts, the twin of the
 * template's grouping): one block per heading × nature, disbursements and our
 * own fees never mixed, a subtotal per block.
 *
 * It is also where a pricer MOVES a line to another family for this file, or
 * makes one up ("DAP Douala–Bangui"). The choice is saved on the line as
 * `client_heading` and rides costing → margin simulation → quotation →
 * invoice; "Catalogue default" clears it back to the dictionary's heading.
 *
 * A registry heading is stored by its CODE, which survives a rename and
 * resolves to the heading's bilingual name at print time; a made-up family is
 * stored as its text.
 *
 * ── MEETING 6 (owner decision G2): ALL FOUR ────────────────────────────────
 *
 *   · MOVE SEVERAL AT ONCE — tick lines here or in the detailed view (the
 *     selection is the caller's, so it survives switching views), then "Move
 *     to family…" (`FamilyBulkBar`).
 *   · A FAMILY COLUMN in the detailed view — `FamilyPicker`, the same control
 *     each line carries here, so a family is changed without switching views.
 *   · DRAG a line between families. The keyboard path is the line's own
 *     family picker (and the bulk bar); every move is announced in a polite
 *     live region, whichever way it was made.
 *   · ORDER THE FAMILIES for this document — ↑ / ↓ on each family (or drag
 *     the family) — saved as the document's `family_order`; "Default order"
 *     returns it to the registry's order (Financial Dictionary › Settings ›
 *     Client headings). The printed quotation and invoice follow it.
 */
import * as React from "react";
import { tr, tv } from "@/lib/i18n";
import { Select } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { usePrompt } from "@/components/ui/use-prompt";
import { useResource } from "@/lib/use-resource";
import { amount as fmt, money } from "@/lib/format";
import { listDictRefs } from "@/lib/masterdata-api";
import {
  familyKeysInOrder,
  groupByFamily,
  headingLabel,
  headingValue,
  resolveHeading,
  OTHER_HEADING,
  type HeadedLine,
  type Heading,
  type HeadingRef,
} from "@/lib/client-headings";

export type FamilyLine = HeadedLine & {
  label: string;
  qty: number | null;
  /** The line's amount in the document's currency (qty × unit). */
  amount: number;
};

const NEW = "__new__";
const CATALOGUE = "";

/* ── the registry, the choices, and moving lines ──────────────────────────── */

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

/** The registry name of a family value, for an announcement. */
function nameOf(value: string | null, registry: HeadingRef[], line?: HeadedLine): string {
  if (value === null) return line ? headingLabel(resolveHeading({ ...line, client_heading: null }, registry)) : tr("the catalogue's family");
  return headingLabel(resolveHeading({ client_heading: value }, registry));
}

/** "New heading…" — a family made up for this document. */
export function useNewFamily(): [() => Promise<string | null>, React.ReactNode] {
  const [prompt, dialog] = usePrompt();
  const ask = React.useCallback(
    async () =>
      (await prompt({
        title: tr("New family for this document"),
        label: tr("Heading the client reads"),
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

/* ── one line's family ─────────────────────────────────────────────────────── */

/** The select's value for a line: its stored override, or the catalogue. */
function valueOf(l: HeadedLine, registry: HeadingRef[]) {
  const raw = (l.client_heading || "").trim();
  if (!raw) return CATALOGUE;
  const hit = registry.find((r) => [r.code, r.name_en, r.name_fr].some((v) => (v || "").toLowerCase() === raw.toLowerCase()));
  return hit ? hit.code : raw;
}

/**
 * The family control for ONE line — in the By-family view and as the detailed
 * view's Family column. It is also the keyboard path for a drag: anything a
 * line can be dragged to, it can be picked into here.
 */
export function FamilyPicker({
  line,
  index,
  registry,
  customs,
  onPick,
  onNew,
  readOnly,
}: {
  line: HeadedLine & { label?: string | null };
  index: number;
  registry: HeadingRef[];
  customs: string[];
  onPick: (heading: string | null) => void;
  onNew: () => Promise<string | null>;
  readOnly?: boolean;
}) {
  const current = resolveHeading(line, registry);
  if (readOnly) return <span className="micro">{headingLabel(current)}</span>;
  const catalogue = resolveHeading({ ...line, client_heading: null }, registry);
  return (
    <Select
      aria-label={`${tr("Family")} — ${line.label || tr("line")} ${index + 1}`}
      value={valueOf(line, registry)}
      onChange={async (e) => {
        const v = e.target.value;
        if (v === NEW) {
          const name = await onNew();
          if (name) onPick(name);
          return;
        }
        onPick(v === CATALOGUE ? null : v);
      }}
    >
      <option value={CATALOGUE}>{`${tr("Catalogue")}: ${headingLabel(catalogue === OTHER_HEADING ? OTHER_HEADING : catalogue)}`}</option>
      {registry.map((r) => (
        <option key={r.code} value={r.code}>
          {headingLabel({ key: r.code, fr: r.name_fr || "", en: r.name_en || "", sort: 0, custom: false })}
        </option>
      ))}
      {customs.map((c) => (
        <option key={`custom:${c}`} value={c}>
          {c}
        </option>
      ))}
      <option value={NEW}>{tr("New heading…")}</option>
    </Select>
  );
}

/* ── move several at once ──────────────────────────────────────────────────── */

export function FamilyBulkBar({
  count,
  registry,
  customs,
  onMove,
  onNew,
  onClear,
}: {
  count: number;
  registry: HeadingRef[];
  customs: string[];
  onMove: (heading: string | null) => void;
  onNew: () => Promise<string | null>;
  onClear: () => void;
}) {
  const [target, setTarget] = React.useState<string>("");
  if (!count) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2" role="group" aria-label={tr("Move the ticked lines")}>
      <span className="text-sm font-semibold text-foreground">{tv("{{count}} lines ticked", { count })}</span>
      <Select aria-label={tr("Move to family…")} value={target} onChange={(e) => setTarget(e.target.value)} className="h-9 w-auto min-w-[14rem] py-0">
        <option value="">{tr("Move to family…")}</option>
        <option value="catalogue">{tr("Each line's catalogue family")}</option>
        {registry.map((r) => (
          <option key={r.code} value={r.code}>
            {headingLabel({ key: r.code, fr: r.name_fr || "", en: r.name_en || "", sort: 0, custom: false })}
          </option>
        ))}
        {customs.map((c) => (
          <option key={`custom:${c}`} value={c}>
            {c}
          </option>
        ))}
        <option value={NEW}>{tr("New heading…")}</option>
      </Select>
      <Button
        size="sm"
        disabled={!target}
        onClick={async () => {
          if (target === NEW) {
            const name = await onNew();
            if (name) onMove(name);
          } else onMove(target === "catalogue" ? null : target);
          setTarget("");
        }}
      >
        {tr("Move")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        {tr("Clear")}
      </Button>
    </div>
  );
}

/* ── the polite announcer ──────────────────────────────────────────────────── */

/** A move is announced however it was made — drag, picker or bulk bar. */
export function useAnnouncer(): [(text: string) => void, React.ReactNode] {
  const [text, setText] = React.useState("");
  const say = React.useCallback((t: string) => {
    // Cleared first so the same sentence twice is still read twice.
    setText("");
    window.setTimeout(() => setText(t), 30);
  }, []);
  const node = (
    <p className="sr-only" aria-live="polite" role="status">
      {text}
    </p>
  );
  return [say, node];
}

/* ── the By-family view ────────────────────────────────────────────────────── */

const LINE_MIME = "application/x-praxis-line";
const FAMILY_MIME = "application/x-praxis-family";

export function ClientFamilies<T extends FamilyLine>({
  lines,
  currency,
  readOnly,
  onHeading,
  onHeadingMany,
  selection,
  order = null,
  onOrder,
}: {
  lines: T[];
  currency: string;
  readOnly: boolean;
  /** Set (or clear, with null) the family of the line at `index`. */
  onHeading: (index: number, heading: string | null) => void;
  /** Set the family of several lines at once (bulk, or a dragged selection). */
  onHeadingMany?: (indices: number[], heading: string | null) => void;
  /** The screen's selection, shared with its detailed view. */
  selection?: LineSelection;
  /** This document's family order (heading keys); null = the registry's. */
  order?: string[] | null;
  onOrder?: (order: string[] | null) => void;
}) {
  const registry = useFamilyRegistry();
  const [ask, askDialog] = useNewFamily();
  const [say, announcer] = useAnnouncer();
  const [dropAt, setDropAt] = React.useState<string | null>(null);

  const families = groupByFamily(lines, registry, order);
  const headings = familyKeysInOrder(lines, registry, order);
  const customs = customFamilies(lines, registry);
  const total = lines.reduce((a, l) => a + (Number(l.amount) || 0), 0);

  const moveMany = (indices: number[], heading: string | null) => {
    if (!indices.length) return;
    if (onHeadingMany) onHeadingMany(indices, heading);
    else indices.forEach((i) => onHeading(i, heading));
    const target = nameOf(heading, registry, lines[indices[0]]);
    say(
      indices.length === 1
        ? tv("“{{line}}” moved to {{family}}.", { line: lines[indices[0]]?.label || tr("line"), family: target })
        : tv("{{count}} lines moved to {{family}}.", { count: indices.length, family: target }),
    );
    selection?.clear();
  };

  /** Move a family one place up or down in this document's order. */
  const shift = (h: Heading, by: -1 | 1) => {
    if (!onOrder) return;
    const keys = headings.map((x) => x.key);
    const at = keys.indexOf(h.key);
    const to = at + by;
    if (at < 0 || to < 0 || to >= keys.length) return;
    [keys[at], keys[to]] = [keys[to], keys[at]];
    onOrder(keys);
    say(tv("{{family}} is now family {{n}} of {{total}}.", { family: headingLabel(h), n: to + 1, total: keys.length }));
  };
  const placeBefore = (key: string, before: Heading) => {
    if (!onOrder || key === before.key) return;
    const keys = headings.map((x) => x.key).filter((k) => k !== key);
    keys.splice(keys.indexOf(before.key), 0, key);
    onOrder(keys);
    const moved = headings.find((x) => x.key === key);
    if (moved) say(tv("{{family}} is now family {{n}} of {{total}}.", { family: headingLabel(moved), n: keys.indexOf(key) + 1, total: keys.length }));
  };

  const firstOfHeading = new Set<string>();

  return (
    <div className="space-y-3">
      {askDialog}
      {announcer}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="micro max-w-prose">
          {tr(
            "What the client's quotation and invoice will print: one line per family, disbursements and our fees kept apart. The costing keeps every line.",
          )}
          {!readOnly ? ` ${tr("Drag a line onto another family, or pick its family in the list; ↑ ↓ set the order this document prints its families in.")}` : ""}
        </p>
        {onOrder && !readOnly && order && order.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => onOrder(null)}>
            {tr("Default order")}
          </Button>
        ) : null}
      </div>

      {selection && !readOnly ? (
        <FamilyBulkBar
          count={selection.selected.size}
          registry={registry}
          customs={customs}
          onNew={ask}
          onClear={selection.clear}
          onMove={(h) => moveMany([...selection.selected], h)}
        />
      ) : null}

      {families.map((f) => {
        const subtotal = f.lines.reduce((a, x) => a + (Number(x.line.amount) || 0), 0);
        const name = headingLabel(f.heading);
        const title = f.mixed ? `${name} — ${f.nature === "disbursement" ? tr("Disbursements") : tr("Service Fee")}` : name;
        const sectionKey = `${f.heading.key}|${f.nature}`;
        const first = !firstOfHeading.has(f.heading.key);
        firstOfHeading.add(f.heading.key);
        const pos = headings.findIndex((h) => h.key === f.heading.key);
        const allTicked = selection ? f.lines.every((x) => selection.selected.has(x.index)) : false;
        return (
          <section
            key={sectionKey}
            aria-label={title}
            className={`rounded-lg border ${dropAt === sectionKey ? "ring-2 ring-ring" : ""}`}
            onDragOver={(e) => {
              if (readOnly) return;
              const types = Array.from(e.dataTransfer.types);
              if (types.includes(LINE_MIME) || types.includes(FAMILY_MIME)) {
                e.preventDefault();
                setDropAt(sectionKey);
              }
            }}
            onDragLeave={() => setDropAt((k) => (k === sectionKey ? null : k))}
            onDrop={(e) => {
              setDropAt(null);
              if (readOnly) return;
              const fam = e.dataTransfer.getData(FAMILY_MIME);
              if (fam) {
                e.preventDefault();
                placeBefore(fam, f.heading);
                return;
              }
              const raw = e.dataTransfer.getData(LINE_MIME);
              if (!raw) return;
              e.preventDefault();
              const indices = raw.split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 0);
              moveMany(indices, headingValue(f.heading));
            }}
          >
            <header
              className="flex items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2"
              draggable={!readOnly && !!onOrder && first}
              onDragStart={(e) => {
                e.dataTransfer.setData(FAMILY_MIME, f.heading.key);
                e.dataTransfer.effectAllowed = "move";
              }}
            >
              <div className="flex min-w-0 items-center gap-2">
                {selection && !readOnly ? (
                  <Checkbox
                    checked={allTicked}
                    onCheckedChange={(on) => selection.setMany(f.lines.map((x) => x.index), on)}
                    label={<span className="sr-only">{tv("Tick every line in {{family}}", { family: title })}</span>}
                  />
                ) : null}
                <h4 className="truncate text-sm font-semibold text-foreground">{title}</h4>
                {f.nature === "disbursement" && <Pill tone="mute">{tr("(PT)")}</Pill>}
                {f.heading.custom && <Pill tone="blue">{tr("This document only")}</Pill>}
              </div>
              <div className="flex items-center gap-1">
                {onOrder && !readOnly && first ? (
                  <>
                    <Button size="sm" variant="ghost" disabled={pos <= 0} aria-label={tv("Move {{family}} up", { family: name })} onClick={() => shift(f.heading, -1)}>
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pos < 0 || pos >= headings.length - 1}
                      aria-label={tv("Move {{family}} down", { family: name })}
                      onClick={() => shift(f.heading, 1)}
                    >
                      ↓
                    </Button>
                  </>
                ) : null}
                <span className="num text-sm font-semibold text-foreground">{fmt(subtotal)}</span>
              </div>
            </header>
            <ul className="divide-y divide-border">
              {f.lines.map(({ line, index }) => (
                <li
                  key={index}
                  draggable={!readOnly}
                  onDragStart={(e) => {
                    // Dragging a ticked line carries every ticked line.
                    const many = selection && selection.selected.has(index) ? [...selection.selected] : [index];
                    e.dataTransfer.setData(LINE_MIME, many.join(","));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className="grid grid-cols-1 items-center gap-2 px-3 py-2 sm:grid-cols-[auto_1fr_16rem_8rem]"
                >
                  {selection && !readOnly ? (
                    <Checkbox
                      checked={selection.selected.has(index)}
                      onCheckedChange={() => selection.toggle(index)}
                      label={<span className="sr-only">{tv("Tick {{line}}", { line: line.label || `${tr("line")} ${index + 1}` })}</span>}
                    />
                  ) : (
                    <span />
                  )}
                  <span className="min-w-0 truncate text-sm text-foreground">{line.label || "—"}</span>
                  <FamilyPicker
                    line={line}
                    index={index}
                    registry={registry}
                    customs={customs}
                    readOnly={readOnly}
                    onNew={ask}
                    onPick={(h) => moveMany([index], h)}
                  />
                  <span className="num text-right text-sm">{fmt(line.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
        <span>{tr("Total (HT)")}</span>
        <span className="num">{money(total, currency)}</span>
      </div>
    </div>
  );
}
