/**
 * Financial dictionary — the gear behind the header. Every dropdown on the
 * dictionary is backed by `dictionary_ref` (seeded, never hardcoded); this panel
 * is where a manager adds/retires values without a release. Same inline "+ Add"
 * shape as master-data-settings.tsx.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { SectionTabs } from "@/components/ui/section-tabs";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useResource, errMsg } from "@/lib/use-resource";
import { marks } from "@praxis/shared";
import * as api from "@/lib/masterdata-api";
import { DictionaryFinder } from "@/components/dictionary-finder";

const KINDS: { kind: api.DictRefKind; label: string }[] = [
  { kind: "SUBCATEGORY", label: "Sub-categories" },
  { kind: "UNIT", label: "Units" },
  { kind: "PROOF_SOURCE", label: "Proof sources" },
  { kind: "PROVIDER_KIND", label: "Provider kinds" },
  // Seed-only until the API enum was opened. A carrier introducing a 50' box
  // used to mean a code change; it is now the same three fields as any other
  // registry value, plus the equipment facts below.
  { kind: "CONTAINER_TYPE", label: "Container types" },
  { kind: "LOAD_MODE", label: "Load modes" },
  // The types a person picks when attaching a file (0669). Also addable inline
  // from the upload picker itself — this tab is for retiring and renaming.
  { kind: "DOCUMENT_TYPE", label: "Document types" },
  // 14130 — the families a quotation and an invoice print lines under
  // ("Customs Formalities"). Each dictionary line picks its default one.
  { kind: "CLIENT_HEADING", label: "Client headings" },
];

/** Seeded families, so a first container type on a fresh tenant still has a
 *  list to choose from. The live distinct values are merged in on top — the
 *  set is open, and a tenant who invents one keeps it. */
const SEED_FAMILIES = [
  "DRY",
  "REEFER",
  "FLATRACK",
  "OPENTOP",
  "ISOTANK",
  "VENTILATED",
  "BULK",
];

const BLANK_FORM = {
  code: "",
  name_fr: "",
  name_en: "",
  teu: "",
  size: "",
  family: "DRY",
  aliases: "",
  marks_token: "",
};

function RefManager({ kind }: { kind: api.DictRefKind }) {
  const toast = useToast();
  const list = useResource(() => api.listDictRefs(kind, true), [kind]);
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState(BLANK_FORM);
  const [busy, setBusy] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  // A container type carries three facts nothing else does, and the cost of
  // leaving them blank is silent rather than loud: `Number(undefined) || 0`
  // makes the box count as zero TEU in the dossier editor and in the shipment
  // TEU total, and no `size` means the rate card has no key to look it up by.
  // So they are captured here, and the API refuses the row without them.
  const isContainer = kind === "CONTAINER_TYPE";
  const teuError =
    isContainer && !(Number(form.teu) > 0)
      ? "TEU is required and must be greater than 0."
      : null;
  const sizeError =
    isContainer && !form.size.trim()
      ? "Size is the rate-card lookup key: required."
      : null;

  const families = React.useMemo(() => {
    const seen = new Set(SEED_FAMILIES);
    for (const r of list.data || [])
      if (r.extra?.family) seen.add(r.extra.family);
    return [...seen];
  }, [list.data]);

  // What this type would print on a marks & numbers line. Derived live from
  // size and family so the field can be left blank and still be right — a blank
  // token would silently shorten a bill of lading.
  const previewToken = marks.marksTokenFor({
    code: form.code,
    extra: { size: form.size.trim(), family: form.family },
  });

  const reset = () => {
    setForm(BLANK_FORM);
    setTouched(false);
  };

  async function submit() {
    setTouched(true);
    if (!form.code || !form.name_fr) {
      toast.error("Code and French name are required");
      return;
    }
    if (teuError || sizeError) return;
    setBusy(true);
    try {
      const aliases = form.aliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      await api.createDictRef({
        kind,
        code: form.code,
        name_fr: form.name_fr,
        name_en: form.name_en || undefined,
        extra: isContainer
          ? {
              teu: Number(form.teu),
              size: form.size.trim(),
              family: form.family,
              ...(aliases.length ? { aliases } : {}),
              // Stored explicitly even when it equals the derived value: the
              // derivation is a fallback for types created before this field
              // existed, not a rule the print format should depend on.
              marks_token: form.marks_token.trim() || previewToken,
            }
          : undefined,
      });
      toast.success("Value added");
      reset();
      setAdding(false);
      list.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  /**
   * The DEFAULT family order (meeting 6, G2) — the order a quotation and an
   * invoice print their client headings in, unless the document sets its own.
   * Only the client-heading registry is ordered here: it is the one list whose
   * order a client reads. Every row is renumbered in steps of 10, so a move is
   * always exact even where seeded values tied.
   */
  const isHeading = kind === "CLIENT_HEADING";
  async function shift(index: number, by: -1 | 1) {
    const rows = [...(list.data || [])];
    const to = index + by;
    if (to < 0 || to >= rows.length) return;
    [rows[index], rows[to]] = [rows[to], rows[index]];
    try {
      const changed = rows
        .map((r, i) => ({ r, sort: (i + 1) * 10 }))
        .filter(({ r, sort }) => r.sort_order !== sort);
      for (const { r, sort } of changed) {
        await api.updateDictRef(r.ref_id, { sort_order: sort });
      }
      toast.success(tr("Family order saved"));
      list.reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  async function toggle(r: api.DictRef) {
    try {
      await api.updateDictRef(r.ref_id, { is_active: !(r.is_active ?? true) });
      list.reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="micro">
          Values a manager can extend. Seeded rows are marked{" "}
          <em>{tr("System")}</em> but stay editable.
          {isHeading
            ? ` ${tr("The order below is the order quotations and invoices print their families in, unless a document sets its own.")}`
            : ""}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setAdding((a) => !a);
            reset();
          }}
        >
          + Add new
        </Button>
      </div>
      {adding && (
        <div className="rounded-lg border bg-card p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              placeholder={tr("CODE")}
              aria-label={tr("Code")}
              value={form.code}
              onChange={(e) =>
                setForm((s) => ({ ...s, code: e.target.value.toUpperCase() }))
              }
            />
            <Input
              placeholder="Nom (FR)"
              aria-label="Nom (FR)"
              value={form.name_fr}
              onChange={(e) =>
                setForm((s) => ({ ...s, name_fr: e.target.value }))
              }
            />
            <Input
              placeholder={tr("Name (EN)")}
              aria-label={tr("Name (EN)")}
              value={form.name_en}
              onChange={(e) =>
                setForm((s) => ({ ...s, name_en: e.target.value }))
              }
            />
          </div>
          {isContainer && (
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <Field
                label={tr("TEU")}
                required
                error={touched ? teuError || undefined : undefined}
                about="Capacity. A 20' is 1, a 40' is 2."
              >
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="num text-right"
                  placeholder="2"
                  value={form.teu}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, teu: e.target.value }))
                  }
                />
              </Field>
              <Field
                label="Size key"
                required
                error={touched ? sizeError || undefined : undefined}
                about="What the rate card calls it: 20, 40, 40HC."
              >
                <Input
                  placeholder="50HC"
                  value={form.size}
                  onChange={(e) =>
                    setForm((s) => ({
                      ...s,
                      size: e.target.value.toUpperCase(),
                    }))
                  }
                />
              </Field>
              <Field
                label="Family"
                about="Groups the sized variants of one kind."
              >
                <Select
                  value={form.family}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, family: e.target.value }))
                  }
                >
                  {families.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Also known as"
                about="Comma-separated, for the finder's search."
              >
                <Input
                  placeholder="50hq, 50dc"
                  value={form.aliases}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, aliases: e.target.value }))
                  }
                />
              </Field>
              <Field
                label="Marks token"
                className="sm:col-span-2"
                hint={`How it prints on marks & numbers: e.g. 02*${form.marks_token.trim() || previewToken}. Leave blank to use the derived value.`}
              >
                <Input
                  placeholder={previewToken}
                  value={form.marks_token}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, marks_token: e.target.value }))
                  }
                />
              </Field>
            </div>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button size="sm" loading={busy} onClick={submit}>
              Add
            </Button>
          </div>
        </div>
      )}
      {list.loading ? (
        <LoadingRow label={tr("Loading…")} />
      ) : list.error ? (
        <ErrorState message={list.error} />
      ) : (list.data || []).length === 0 ? (
        <EmptyState title={tr("Nothing yet")} hint="Add your first value." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {(list.data || []).map((r, i, all) => (
                <tr
                  key={r.ref_id}
                  className={r.is_active === false ? "opacity-50" : ""}
                >
                  {isHeading && (
                    <td className="w-20 px-1 py-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={i === 0}
                        aria-label={`${tr("Move up")}: ${r.name_en || r.name_fr}`}
                        onClick={() => void shift(i, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={i === all.length - 1}
                        aria-label={`${tr("Move down")}: ${r.name_en || r.name_fr}`}
                        onClick={() => void shift(i, 1)}
                      >
                        ↓
                      </Button>
                    </td>
                  )}
                  <td className="px-3 py-1.5 num font-medium text-foreground">
                    {r.code}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {r.name_fr}
                    {r.name_en ? ` · ${r.name_en}` : ""}
                  </td>
                  {/* The equipment facts are shown because they are the ones a
                      manager cannot infer from the name, and a wrong TEU is
                      otherwise invisible until a capacity report is wrong. */}
                  {isContainer && (
                    <td className="px-3 py-1.5 micro text-muted-foreground">
                      {r.extra?.teu ? (
                        `${r.extra.teu} TEU`
                      ) : (
                        <span className="text-destructive">no TEU</span>
                      )}
                      {r.extra?.size ? ` · ${r.extra.size}` : ""}
                      {r.extra?.family ? ` · ${r.extra.family}` : ""}
                      {` · prints ${marks.marksTokenFor(r)}`}
                    </td>
                  )}
                  <td className="px-3 py-1.5">
                    {r.is_system && <Pill tone="mute">{tr("System")}</Pill>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={() => toggle(r)}
                      className="text-sm text-primary-ink underline"
                    >
                      {(r.is_active ?? true) ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Lines to pair (14342, meeting 6 F2) ──────────────────────────────────── */

const REASON: Record<api.UnpairedDictLine["reason"], string> = {
  NO_PARTNER:
    "Named as one way of charging a service, but no other line of that service was found.",
  MODE_CONTRADICTS_NAME:
    "Its name says one way of charging, its direction says another.",
};

/**
 * The lines the sibling backfill could not pair, for a person to settle: link
 * each to the other line of the same service, or confirm it stands alone.
 * Nothing here was guessed by the migration; a row leaves the list once
 * someone answers it.
 */
export function SiblingPairing() {
  const toast = useToast();
  const list = useResource(() => api.unpairedDictLines(), []);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function settle(
    id: string,
    body: { link_to: string } | { stands_alone: true },
  ) {
    setBusy(id);
    try {
      await api.linkDictSibling(id, body);
      toast.success(
        "stands_alone" in body
          ? tr("Confirmed as a line of its own")
          : tr("Linked"),
      );
      list.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  if (list.error) return <ErrorState message={list.error} />;
  if (!list.data) return <LoadingRow label={tr("Loading…")} />;
  if (!list.data.length)
    return (
      <EmptyState
        title={tr("Every line is paired")}
        hint={tr(
          "Each service charged several ways is linked, so pickers show it once and ask how it is charged.",
        )}
      />
    );
  return (
    <div className="space-y-2">
      <p className="micro">
        {tr(
          "Pickers show a service once and ask whether it is billed to the client at cost or our own cost. These lines could not be paired automatically: link each one, or confirm it stands alone.",
        )}
      </p>
      {list.data.map((r) => (
        <div
          key={r.dictionary_item_id}
          className="space-y-2 rounded-lg border px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {r.code}
            </span>
            <span className="text-sm text-foreground">
              {r.label_en || r.label_fr}
            </span>
            <Pill tone="mute">{r.direction}</Pill>
          </div>
          <p className="micro">{tr(REASON[r.reason])}</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[14rem] flex-1">
              <DictionaryFinder
                label={`${tr("Link")} ${r.code} ${tr("to")}`}
                placeholder={tr("Link to the other line of this service…")}
                allowEmpty={false}
                groupSiblings={false}
                onPick={(id) =>
                  id
                    ? void settle(r.dictionary_item_id, { link_to: id })
                    : undefined
                }
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              loading={busy === r.dictionary_item_id}
              onClick={() =>
                void settle(r.dictionary_item_id, { stands_alone: true })
              }
            >
              {tr("Stands alone")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── One review of the existing postings (meeting 6, F8) ────────────────── */

/** A review line's stored suggestion, in the shape the edit form shows. */
function reviewSuggestion(
  l: api.PostingReview["lines"][number],
): api.PostingSuggestion | null {
  if (!l.suggestion) return null;
  return {
    source: l.source ?? "cache",
    model: l.model,
    cache_entry_id: null,
    answered_at: null,
    direction: l.suggestion.direction,
    is_disbursement: l.suggestion.is_disbursement,
    vat_treatment: l.suggestion.vat_treatment,
    rules: l.suggestion.rules,
    needs_mint: l.suggestion.rules.some(
      (r) => !r.debit_account || !r.credit_account,
    ),
    confidence: l.confidence ?? "low",
    check_needed: (l.confidence ?? "low") === "low",
    rationale: l.reasons.join("; "),
    sources: [],
    search_suggestion_html: null,
    matched_label: null,
    similarity: null,
    fallback_reason: null,
    cost: { native: 0, currency: null, search: 0 },
  };
}

/**
 * Start the review, watch it run, and open a mismatched line through the
 * ORDINARY edit with the suggestion beside its posting. The review itself
 * changes nothing; past postings never change.
 */
export function PostingReviewPanel({
  onOpenItem,
}: {
  onOpenItem?: (id: string, suggestion: api.PostingSuggestion | null) => void;
}) {
  const toast = useToast();
  const res = useResource(() => api.getPostingReview(), []);
  const [starting, setStarting] = React.useState(false);
  const review = res.data?.review ?? null;
  const running = review?.status === "queued" || review?.status === "running";
  const { reload } = res;
  React.useEffect(() => {
    if (!running) return;
    const h = setInterval(reload, 4000);
    return () => clearInterval(h);
  }, [running, reload]);

  async function start() {
    setStarting(true);
    try {
      const out = await api.startPostingReview();
      toast.success(
        out.already_running
          ? tr("A review is already running")
          : tr("Review started"),
      );
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setStarting(false);
    }
  }

  if (res.error) return <ErrorState message={res.error} />;
  if (!res.data) return <LoadingRow label={tr("Loading…")} />;
  const mismatches = res.data.lines.filter((l) => l.outcome === "mismatch");
  const unanswered = res.data.lines.filter(
    (l) => l.outcome === "no_suggestion",
  );
  return (
    <div className="space-y-3">
      <p className="micro">
        {tr(
          "Compares every line's posting with the AI suggestion and lists those that differ. It changes nothing: apply a suggestion line by line through the ordinary edit.",
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          loading={starting}
          disabled={running}
          onClick={() => void start()}
        >
          {review ? tr("Review again") : tr("Start the review")}
        </Button>
        {review && (
          <span className="micro">
            {running
              ? `${tr("Running")} · ${review.examined}/${review.total}`
              : review.status === "failed"
                ? `${tr("Stopped")}: ${review.error ?? ""}`
                : `${tr("Done")} · ${review.mismatches} ${tr("to look at")} · ${review.fresh_calls} ${tr("web searches")}`}
          </span>
        )}
      </div>
      {mismatches.length === 0 && !running && review?.status === "done" ? (
        <EmptyState
          title={tr("Every posting matches")}
          hint={tr("No line's posting differs from the suggestion.")}
        />
      ) : (
        mismatches.map((l) => (
          <div
            key={l.dictionary_item_id}
            className="space-y-1 rounded-lg border px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">
                {l.code}
              </span>
              <span className="text-sm text-foreground">
                {l.label_en || l.label_fr}
              </span>
              {l.confidence && (
                <Pill
                  tone={
                    l.confidence === "high"
                      ? "ok"
                      : l.confidence === "medium"
                        ? "warn"
                        : "bad"
                  }
                >
                  {tr(l.confidence)}
                </Pill>
              )}
              {onOpenItem && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() =>
                    onOpenItem(l.dictionary_item_id, reviewSuggestion(l))
                  }
                >
                  {tr("Open in edit")}
                </Button>
              )}
            </div>
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {l.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        ))
      )}
      {unanswered.length > 0 && (
        <p className="micro">
          {unanswered.length}{" "}
          {tr(
            "line(s) could not be compared this run (no web search answer): run the review again later.",
          )}
        </p>
      )}
    </div>
  );
}

type SettingsTab = api.DictRefKind | "PAIRING" | "POSTING_REVIEW";

export function FinancialDictionarySettings({
  open,
  onClose,
  onOpenItem,
}: {
  open: boolean;
  onClose: () => void;
  /** Open a line in the ordinary edit, with a suggestion beside its posting. */
  onOpenItem?: (id: string, suggestion: api.PostingSuggestion | null) => void;
}) {
  const [kind, setKind] = React.useState<SettingsTab>("SUBCATEGORY");
  if (!open) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Dictionary settings"
      description="Seeded-but-editable values behind every dropdown."
    >
      <SectionTabs
        label="Dictionary kinds"
        value={kind}
        onChange={setKind}
        className="mb-4"
        tabs={[
          ...KINDS.map((k) => ({
            value: k.kind as SettingsTab,
            label: k.label,
          })),
          { value: "PAIRING" as SettingsTab, label: tr("Lines to pair") },
          {
            value: "POSTING_REVIEW" as SettingsTab,
            label: tr("Posting review"),
          },
        ]}
      />
      <div className="max-h-[60vh] overflow-auto pr-1">
        {kind === "PAIRING" ? (
          <SiblingPairing />
        ) : kind === "POSTING_REVIEW" ? (
          <PostingReviewPanel onOpenItem={onOpenItem} />
        ) : (
          <RefManager kind={kind} />
        )}
      </div>
    </Modal>
  );
}
