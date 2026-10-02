/**
 * Milestone template editor — the screen a forwarder writes their operating
 * procedure in.
 *
 * WHAT CHANGED, and why the old version could not stay. It edited four fields
 * per stage (code, two labels, an offset in days) and offered three five-stage
 * presets. The engine now schedules on WEIGHTS over a working-time horizon,
 * with per-stage compression floors, an owner tier that delay is attributed to,
 * an anchor, and a locked SLA date — none of which were reachable from the UI.
 * A tenant could see the shipped 14-stage chain and not change the one number
 * (weight) that decides when anything is due.
 *
 * THE SHAPE. One row per stage: sequence, code, BOTH labels, weight, owner, and
 * the flags as icons. Expanding a row reveals the rest (floor, evidence,
 * auto-advance, segment/cadence). Fourteen rows of ten fields laid out flat is a
 * wall; the summary line is what a user scans, and the detail is what they
 * occasionally edit.
 *
 * BOTH NAMES ARE ON THE ROW, AND THE DIALOG IS FULL WIDTH (meeting 7, 1 Oct 2026,
 * 01:38:25 and 01:55:13). The English label used to live behind the ▸ expander,
 * which the owner found live in front of the tenant: "It doesn't give you the
 * possibility of changing the English name. It gives you just the French name. So
 * ensure that when we are creating it permits us change both English and French
 * names. That's something we should take note of. It's a gap in the UI." And then:
 * "we make this model a bit larger so it can accommodate all of that … if the
 * model can cover probably full width … we can see the full English name, full
 * French name. We see this code here." A field one click out of sight is a field
 * a bilingual tenant does not fill in, and an unfilled English label is what an
 * English-reading desk then reads a French stage name from.
 *
 * THE OWNER COMES FROM A REGISTRY, NOT AN ENUM (01:57:20). The five values were
 * hardcoded; they are now the tenant's `milestone_owner` rows, and the gear beside
 * the dropdown opens the registry where you noticed it was missing a party.
 *
 * THE WEIGHT METER IS THE POINT. Weights are a share of the horizon and must
 * sum to 100 PER SEGMENT — a segment summing to 97 silently shortens every
 * forecast on that service by 3%, forever, with no error anywhere. So the sum
 * is shown live, per segment, and publishing is blocked until it balances.
 * That is the one invariant a user cannot be trusted to hold in their head
 * while dragging fourteen numbers around.
 *
 * WEIGHTS ARE SHOWN IN DAYS AS WELL AS PERCENT. A weight only means something
 * against the service's horizon, and repartitioning after a delete (01:58:19:
 * "you need to come and repartition the weight so that it's fully 100%") is
 * otherwise mental arithmetic over a number nobody has in front of them.
 *
 * DRIFT, NOT LOCK-IN. Stages ship as system defaults (9091) and are ordinary
 * editable rows. The header says how far the current chain has drifted from
 * what shipped, and "Restore the default" puts it back — the financial
 * dictionary's contract, applied to milestones.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { Checkbox } from "@/components/ui/checkbox";
import { errMsg, useResource } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";
import { useMilestoneOwners } from "@/lib/milestone-owners";
import { MilestoneOwnersDialog } from "./milestone-owners-dialog";

/** A stage row in the editor. Numbers are strings while being typed. */
type Row = {
  code: string;
  label_fr: string;
  label_en: string;
  weight: string;
  min_duration_hours: string;
  owner_tier: api.OwnerTier;
  is_anchor: boolean;
  is_target_lock: boolean;
  is_client_visible: boolean;
  is_optional: boolean;
  chain_segment: string;
  cadence: string;
  required_evidence_doc_type: string;
  auto_advance_on_event: string;
};

const BLANK: Row = {
  code: "",
  label_fr: "",
  label_en: "",
  weight: "0",
  min_duration_hours: "0",
  owner_tier: "INTERNAL",
  is_anchor: false,
  is_target_lock: false,
  is_client_visible: true,
  is_optional: false,
  chain_segment: "MAIN",
  cadence: "",
  required_evidence_doc_type: "",
  auto_advance_on_event: "",
};

/** Bounds mirror milestone.validator.js and the 0650 trigger. */
const MIN_STAGES = 3;
const MAX_STAGES = 15;

const toRow = (s: api.MilestoneStage): Row => ({
  code: s.code || "",
  label_fr: s.label_fr || "",
  label_en: s.label_en || "",
  weight: String(s.weight ?? 0),
  min_duration_hours: String(s.min_duration_hours ?? 0),
  owner_tier: (s.owner_tier as api.OwnerTier) || "INTERNAL",
  is_anchor: !!s.is_anchor,
  is_target_lock: !!s.is_target_lock,
  is_client_visible: s.is_client_visible !== false,
  is_optional: !!s.is_optional,
  chain_segment: s.chain_segment || "MAIN",
  cadence: s.cadence || "",
  required_evidence_doc_type: s.required_evidence_doc_type || "",
  auto_advance_on_event: s.auto_advance_on_event || "",
});

/** Weight totals per chain segment — the invariant publishing is gated on. */
function segmentTotals(rows: Row[]) {
  const out = new Map<string, number>();
  for (const r of rows) {
    const seg = r.chain_segment || "MAIN";
    out.set(seg, (out.get(seg) || 0) + (Number(r.weight) || 0));
  }
  return [...out.entries()];
}

/**
 * What a weight means in days, against the service's own horizon.
 *
 * Returns null when the service has no duration (nothing honest to show) and for
 * a STEADY segment, which runs on cadence and never enters the horizon maths. The
 * figure is deliberately approximate — the real schedule runs on a working
 * calendar and per-stage floors (milestone.schedule) — so it is rendered with ≈
 * and never presented as the date anything is due.
 */
function weightDays(svc: api.ServiceType, weight: string, segment: string): number | null {
  if (segment === "STEADY") return null;
  const total = Number(svc.default_duration_days || 0);
  if (!(total > 0)) return null;
  const w = Number(weight) || 0;
  if (w <= 0) return null;
  return Math.round(((total * w) / 100) * 10) / 10;
}

/** The unit `default_duration_days` is counted in, for the preview's wording. */
const durationUnit = (svc: api.ServiceType) =>
  svc.duration_basis === "MONTHS" ? "months" : "days";

/** A segment is balanced at 100, except cadence-driven STEADY which carries none. */
const segmentOk = (seg: string, total: number) =>
  seg === "STEADY" ? total === 0 : total === 100;

/** How far this chain has moved from what shipped — counted, not guessed. */
function driftCount(rows: Row[], shipped: api.MilestoneStage[]) {
  if (!shipped.length) return 0;
  const byCode = new Map(shipped.map((s) => [s.code, s]));
  let n = 0;
  if (rows.length !== shipped.length)
    n += Math.abs(rows.length - shipped.length);
  for (const r of rows) {
    const s = byCode.get(r.code);
    if (!s) {
      n += 1;
      continue;
    }
    if (
      (s.label_fr || "") !== r.label_fr ||
      String(s.weight ?? 0) !== r.weight ||
      String(s.min_duration_hours ?? 0) !== r.min_duration_hours ||
      (s.owner_tier || "INTERNAL") !== r.owner_tier ||
      !!s.is_target_lock !== r.is_target_lock ||
      !!s.is_anchor !== r.is_anchor
    )
      n += 1;
  }
  return n;
}

export function TemplateForm({
  svc,
  onClose,
  onSaved,
  initial,
}: {
  svc: api.ServiceType;
  onClose: () => void;
  onSaved: () => void;
  /**
   * Stages to seed the editor from. When given — "Edit chain" on an existing
   * template — the editor starts from THAT version, so re-publishing a chain
   * does not silently revert it to the shipped default. Omitted for a first
   * template, which starts from what shipped.
   */
  initial?: api.MilestoneStage[];
}) {
  const shipped = useResource(
    () => api.milestoneSystemDefault(svc.service_type_id),
    [svc.service_type_id],
  );
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [open, setOpen] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // The owner registry (14400) and the gear that edits it. Nested dialog, same
  // shape as FieldOptionsDialog over the fields tab: the moment you notice the
  // party you need is missing is the moment to add it, not after cancelling out.
  const ownerReg = useMilestoneOwners();
  const [ownersOpen, setOwnersOpen] = React.useState(false);

  // Seed from the current version when editing one; from what shipped when
  // publishing a first template. A tenant editing their chain wants the REAL
  // stages in front of them — either their own, or the 14 that shipped.
  React.useEffect(() => {
    if (rows) return;
    if (initial && initial.length) {
      setRows(initial.map(toRow));
      return;
    }
    if (!shipped.data) return;
    setRows(shipped.data.length ? shipped.data.map(toRow) : [{ ...BLANK }]);
  }, [initial, shipped.data, rows]);

  const list = rows || [];
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((s) =>
      (s || []).map((r, ix) => (ix === i ? { ...r, ...patch } : r)),
    );
  const addRow = () => setRows((s) => [...(s || []), { ...BLANK }]);
  const removeRow = (i: number) =>
    setRows((s) => (s || []).filter((_, ix) => ix !== i));
  const move = (i: number, by: number) =>
    setRows((s) => {
      const next = [...(s || [])];
      const j = i + by;
      if (j < 0 || j >= next.length) return next;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const totals = segmentTotals(list);
  const balanced = totals.every(([seg, total]) => segmentOk(seg, total));
  const named = list.every((r) => r.code.trim() && r.label_fr.trim());
  const counted = list.length >= MIN_STAGES && list.length <= MAX_STAGES;
  const locks = list.filter((r) => r.is_target_lock).length;
  const drift = driftCount(list, shipped.data || []);

  const canPublish = balanced && named && counted && locks >= 1 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.publishMilestoneTemplate({
        service_type_id: svc.service_type_id,
        stages: list.map((s, i) => ({
          stage_seq: i + 1,
          code: s.code.trim().toUpperCase(),
          label_fr: s.label_fr.trim(),
          label_en: s.label_en.trim() || undefined,
          weight: Number(s.weight) || 0,
          min_duration_hours: Number(s.min_duration_hours) || 0,
          owner_tier: s.owner_tier,
          is_anchor: s.is_anchor,
          is_target_lock: s.is_target_lock,
          is_client_visible: s.is_client_visible,
          is_optional: s.is_optional,
          chain_segment: s.chain_segment || "MAIN",
          cadence: (s.cadence || undefined) as api.Cadence | undefined,
          required_evidence_doc_type:
            s.required_evidence_doc_type.trim() || undefined,
          auto_advance_on_event: s.auto_advance_on_event.trim() || undefined,
        })),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      /* Full width, not `xl` (max-w-3xl): two labels, a code, a weight and an
         owner on one row do not fit in 768px, which is what pushed the English
         label behind an expander in the first place (meeting 7, 01:55:13). */
      size="wide"
      title={`Milestone chain — ${svc.name_en || svc.name_fr}`}
      description="The stages every new file of this service type starts with. Publishing creates a new active version; files already open keep the stages they were given."
      headerRight={
        drift > 0 ? (
          <Pill tone="warn">
            {drift === 1
              ? "1 change from default"
              : `${drift} changes from default`}
          </Pill>
        ) : shipped.data?.length ? (
          <Pill tone="ok">Matches the shipped default</Pill>
        ) : null
      }
    >
      {shipped.loading && !rows ? (
        <p className="micro">Loading the shipped chain…</p>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          {/* The weight meter. Publishing is gated on this, so it leads. */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
            <span className="micro">Weight per segment</span>
            {totals.map(([seg, total]) => (
              <Pill key={seg} tone={segmentOk(seg, total) ? "ok" : "bad"}>
                {seg === "MAIN" ? "" : `${seg} `}
                {total}
                {seg === "STEADY" ? " (cadence)" : " / 100"}
              </Pill>
            ))}
            {svc.default_duration_days ? (
              <span className="micro text-muted-foreground">
                over {svc.default_duration_days} {durationUnit(svc)}
              </span>
            ) : null}
            <span className="ml-auto micro">
              {list.length} {list.length === 1 ? "stage" : "stages"} (allowed{" "}
              {MIN_STAGES}–{MAX_STAGES})
            </span>
            {/* The configuration button the meeting asked for (01:57:20), beside
                the owners it configures rather than on a settings page nobody is
                on when they notice the gap. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOwnersOpen(true)}
            >
              Milestone owners…
            </Button>
          </div>

          <div className="space-y-1">
            {list.map((r, i) => (
              <div key={i} className="rounded-lg border border-border">
                {/* Summary line — what a user scans, and now everything a user
                    EDITS: both labels included (meeting 7, 01:38:25). */}
                <div className="grid items-center gap-2 px-2 py-1.5 lg:grid-cols-[auto_2fr_3fr_3fr_auto_auto_auto]">
                  <span className="num micro w-6 text-right">{i + 1}</span>
                  <Input
                    value={r.code}
                    onChange={(e) =>
                      setRow(i, { code: e.target.value.toUpperCase() })
                    }
                    placeholder="VESSEL_ARRIVED"
                    aria-label={`Stage ${i + 1} code`}
                  />
                  <Input
                    value={r.label_fr}
                    onChange={(e) => setRow(i, { label_fr: e.target.value })}
                    placeholder="Navire arrivé"
                    aria-label={`Stage ${i + 1} label (French)`}
                  />
                  {/* Beside the French one, not behind the expander. */}
                  <Input
                    value={r.label_en}
                    onChange={(e) => setRow(i, { label_en: e.target.value })}
                    placeholder="Vessel arrived"
                    aria-label={`Stage ${i + 1} label (English)`}
                  />
                  <div className="flex items-center gap-1">
                    <Input
                      value={r.weight}
                      onChange={(e) =>
                        setRow(i, {
                          weight: e.target.value.replace(/[^0-9]/g, ""),
                        })
                      }
                      className="num w-14"
                      aria-label={`Stage ${i + 1} weight`}
                    />
                    <span className="micro whitespace-nowrap">
                      %
                      {/* What the percentage is, in the unit the operator thinks
                          in. Approximate on purpose — the real dates come off the
                          working calendar and the per-stage floors. */}
                      {(() => {
                        const d = weightDays(svc, r.weight, r.chain_segment);
                        return d === null ? null : (
                          <span className="text-muted-foreground"> ≈{d}</span>
                        );
                      })()}
                    </span>
                  </div>
                  <Select
                    value={r.owner_tier}
                    onChange={(e) =>
                      setRow(i, { owner_tier: e.target.value as api.OwnerTier })
                    }
                    aria-label={`Stage ${i + 1} owner`}
                    className="max-w-[11rem]"
                  >
                    {/* `optionsWith` keeps a stage's stored owner in its own
                        dropdown even after the tenant deactivates it — otherwise
                        editing the weight silently reassigns the owner. */}
                    {ownerReg.optionsWith(r.owner_tier).map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <div className="flex items-center justify-end gap-0.5">
                    {r.is_anchor && <Pill tone="blue">anchor</Pill>}
                    {r.is_target_lock && <Pill tone="orange">{tr("SLA")}</Pill>}
                    {!r.is_client_visible && <Pill tone="mute">internal</Pill>}
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${r.code || `stage ${i + 1}`} earlier`}
                      className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === list.length - 1}
                      aria-label={`Move ${r.code || `stage ${i + 1}`} later`}
                      className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen(open === i ? null : i)}
                      aria-expanded={open === i}
                      aria-label={`${open === i ? "Hide" : "Show"} details for ${r.code || `stage ${i + 1}`}`}
                      className="px-1 text-muted-foreground hover:text-foreground"
                    >
                      {open === i ? "▾" : "▸"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      disabled={list.length <= MIN_STAGES}
                      aria-label={`Remove ${r.code || `stage ${i + 1}`}`}
                      className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {open === i && (
                  <div className="grid gap-3 border-t border-border px-3 py-3 sm:grid-cols-2 lg:grid-cols-3">
                    {/* The English label used to be here. It is on the summary
                        row now — see the header. */}
                    <Field
                      label="Minimum duration (hours)"
                      hint="The floor this stage can never be compressed below, however late the file runs."
                    >
                      <Input
                        value={r.min_duration_hours}
                        onChange={(e) =>
                          setRow(i, {
                            min_duration_hours: e.target.value.replace(
                              /[^0-9]/g,
                              "",
                            ),
                          })
                        }
                        className="num"
                      />
                    </Field>
                    <Field
                      label="Segment"
                      hint="MAIN for a normal chain; INBOUND / STEADY / OUTBOUND for open-ended services."
                    >
                      <Input
                        value={r.chain_segment}
                        onChange={(e) =>
                          setRow(i, {
                            chain_segment: e.target.value.toUpperCase(),
                          })
                        }
                      />
                    </Field>
                    <Field
                      label={tr("Cadence")}
                      hint="Set only for steady-state stages, which run on a rhythm and are never overdue."
                    >
                      <Select
                        value={r.cadence}
                        onChange={(e) => setRow(i, { cadence: e.target.value })}
                      >
                        <option value="">None — scheduled normally</option>
                        {api.CADENCES.map((c) => (
                          <option key={c} value={c}>
                            {c.charAt(0) + c.slice(1).toLowerCase()}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="Required evidence"
                      hint="Document type that proves this stage happened."
                    >
                      <Input
                        value={r.required_evidence_doc_type}
                        onChange={(e) =>
                          setRow(i, {
                            required_evidence_doc_type:
                              e.target.value.toUpperCase(),
                          })
                        }
                        placeholder={tr("POD")}
                      />
                    </Field>
                    <Field
                      label="Completed automatically by"
                      hint="An event key that completes this stage when it fires, e.g. delivery_note.created."
                    >
                      <Input
                        value={r.auto_advance_on_event}
                        onChange={(e) =>
                          setRow(i, { auto_advance_on_event: e.target.value })
                        }
                        placeholder="delivery_note.created"
                      />
                    </Field>
                    <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                      <Checkbox
                        checked={r.is_anchor}
                        onCheckedChange={(v) => setRow(i, { is_anchor: v })}
                        label="Anchor — the schedule stays provisional until this happens"
                      />
                      <Checkbox
                        checked={r.is_target_lock}
                        onCheckedChange={(v) =>
                          setRow(i, { is_target_lock: v })
                        }
                        label="SLA date — hold this commitment and compress what remains instead of moving it"
                      />
                      <Checkbox
                        checked={r.is_client_visible}
                        onCheckedChange={(v) =>
                          setRow(i, { is_client_visible: v })
                        }
                        label="Visible to the client on the portal"
                      />
                      <Checkbox
                        checked={r.is_optional}
                        onCheckedChange={(v) => setRow(i, { is_optional: v })}
                        label="Optional — may be skipped without blocking the chain"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addRow}
              disabled={list.length >= MAX_STAGES}
            >
              Add stage
            </Button>
            {shipped.data?.length ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRows(shipped.data!.map(toRow))}
                disabled={drift === 0}
              >
                Restore the default
              </Button>
            ) : null}
          </div>

          {/* Why publishing is blocked, said plainly rather than as a dead button. */}
          {!canPublish && (
            <ul className="space-y-1 micro">
              {!balanced && (
                <li>
                  Each segment&apos;s weights must total 100 — they are the
                  share of the file&apos;s time each stage gets.
                </li>
              )}
              {!named && <li>Every stage needs a code and a French label.</li>}
              {!counted && (
                <li>
                  A chain must have between {MIN_STAGES} and {MAX_STAGES}{" "}
                  stages.
                </li>
              )}
              {locks === 0 && (
                <li>
                  Mark one stage as the SLA date, so there is a commitment to
                  protect.
                </li>
              )}
            </ul>
          )}

          <MilestoneOwnersDialog
            open={ownersOpen}
            onClose={() => setOwnersOpen(false)}
            onChanged={ownerReg.reload}
          />

          {error && <p className="text-sm text-[rgb(var(--bad))]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!canPublish}>
              Publish new version
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
