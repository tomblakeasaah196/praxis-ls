/**
 * The parties a milestone stage can be owned by — the registry behind the owner
 * dropdown, editable where you hit its limit.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Meeting 7 (1 Oct 2026), 01:56:14 → 01:57:20. Reviewing the project-cargo chain
 * the owner reached the owner dropdown and found it closed:
 *
 *   "it's good to put the party that is directly involved in the operation and I
 *    think we should even have the possibility of adding more parties here so if
 *    it's not amongst this listed here … we should have the possibility of adding.
 *    So maybe under milestones, let me see if we already have it. No, we don't
 *    have that. So we're going to have a settings button, a configurations button
 *    that will permit us to create new milestone owner categories."
 *
 * Five values were hardcoded in four places at once (two DB CHECKs, a zod enum, a
 * frontend const), so a forwarder whose permits sit with a ROAD authority and
 * whose survey sits with a marine SURVEYOR filed both under "Authority" — and so
 * did the delay-attribution report, which is the one screen that exists to tell
 * those two apart.
 *
 * ── WHAT A ROW IS, AND WHY THE CODE IS FROZEN ───────────────────────────────
 *
 * `code` is what every stage and every closed milestone STORES, and what the
 * attribution report groups on. Renaming it would orphan the history filed under
 * the old string, so it is set once on create and read-only afterwards — the same
 * rule the field-options dialog applies to an option's value, and the reason that
 * dialog warns rather than freezes is not available here (there is no safe
 * migration of a code that instances already carry). The two NAMES are what a
 * person reads and are freely editable in both languages, which is the half the
 * meeting also asked for.
 *
 * `is_internal` is the one switch that changes behaviour and it is spelled out
 * rather than inferred: the attribution report's whole job is "ours or theirs",
 * and a tenant who adds "Internal — customs desk" means ours.
 *
 * ── SYSTEM ROWS DEACTIVATE, NEVER DELETE ────────────────────────────────────
 *
 * Shipped rows (seed 90998) are renameable and switchable off, never deletable —
 * spec §6.2, enforced by the server (422 SYSTEM_TYPE). A tenant row deletes
 * unless something references it, which the server turns into a 409 telling you
 * to deactivate instead. Both messages are shown as they arrive rather than
 * re-worded here, because the server knows which case it hit.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { errMsg, useResource } from "@/lib/use-resource";
import * as api from "@/lib/operations-api";

/** A new row being typed. Kept separate from the saved rows being patched. */
type Draft = {
  code: string;
  name: string;
  name_fr: string;
  is_internal: boolean;
  description: string;
};

const BLANK: Draft = { code: "", name: "", name_fr: "", is_internal: false, description: "" };

/** Mirrors `milestone_owner_code_shape` (14400) so the error is local, not a 422. */
const CODE_SHAPE = /^[A-Z][A-Z0-9_]{1,31}$/;

/** Suggest a code from the English name, so nobody has to invent one by hand. */
const codeFromName = (name: string) =>
  name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);

export function MilestoneOwnersDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after any write, so the dropdown that opened this re-reads. */
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  // Every row, deactivated ones included: this is the management surface, and a
  // row you switched off has to be findable to switch back on.
  const res = useResource(() => (open ? api.listAllMilestoneOwners() : Promise.resolve([])), [open]);
  const [draft, setDraft] = React.useState<Draft>(BLANK);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setDraft(BLANK);
    setError(null);
  }, [open]);

  const rows = res.data || [];
  const taken = new Set(rows.map((r) => r.code));
  const codeOk = CODE_SHAPE.test(draft.code);
  const codeFree = !taken.has(draft.code);
  const canAdd = codeOk && codeFree && !!draft.name.trim() && busy === null;

  const after = () => {
    res.reload();
    onChanged?.();
  };

  async function add() {
    setBusy("new");
    setError(null);
    try {
      await api.createMilestoneOwner({
        code: draft.code,
        name: draft.name.trim(),
        name_fr: draft.name_fr.trim() || null,
        is_internal: draft.is_internal,
        description: draft.description.trim() || null,
        // Lands after every shipped row but before OTHER_PARTY's 90, so a
        // tenant's own owners group together near the end of the list.
        sort_order: 80,
      });
      setDraft(BLANK);
      toast.success("Milestone owner added");
      after();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function patch(row: api.MilestoneOwner, body: Parameters<typeof api.updateMilestoneOwner>[1]) {
    setBusy(row.owner_id);
    setError(null);
    try {
      await api.updateMilestoneOwner(row.owner_id, body);
      after();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: api.MilestoneOwner) {
    if (
      !(await confirm({
        title: `Delete the owner "${row.name}"?`,
        body:
          "Stages owned by it keep the code they were saved with, so the chain is not " +
          "changed: but it stops being offered, and nothing can be assigned to it again. " +
          "If it is already in use, deactivate it instead.",
        confirmLabel: "Delete owner",
        destructive: true,
      }))
    )
      return;
    setBusy(row.owner_id);
    setError(null);
    try {
      await api.deleteMilestoneOwner(row.owner_id);
      toast.success(`"${row.name}" deleted`);
      after();
    } catch (e) {
      // The server distinguishes "shipped row" (422) from "in use" (409) and
      // says what to do instead. Showing its words beats guessing which it was.
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="lg"
        title="Milestone owners"
        description="The parties a stage can be waiting on. Pick one on every stage so a delay has somebody to be charged to."
        footer={
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        }
      >
        <div className="space-y-4">
          <Callout tone="info" title="The code is permanent">
            Every stage and every completed milestone stores the <strong>code</strong>, and the
            delay report groups on it — so it cannot be renamed later. The two names can be
            rewritten whenever you like, in both languages.
          </Callout>

          {error && <ErrorState message={error} />}

          {res.loading ? (
            <LoadingRow label="Loading milestone owners…" />
          ) : res.error ? (
            <ErrorState message={res.error} />
          ) : rows.length === 0 ? (
            <EmptyState title="No owners yet" hint="Add the first one below." />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <THead>
                  <TR>
                    <TH>{tr("Code")}</TH>
                    <TH>Name (EN)</TH>
                    <TH>Name (FR)</TH>
                    <TH>Ours?</TH>
                    <TH>{tr("Actions")}</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r) => {
                    const rowBusy = busy === r.owner_id;
                    const off = r.is_active === false;
                    return (
                      <TR key={r.owner_id}>
                        <TD className="num text-sm font-medium">
                          <span className="flex items-center gap-1.5">
                            {r.code}
                            {r.is_system && <Pill tone="mute">shipped</Pill>}
                            {off && <Pill tone="warn">off</Pill>}
                          </span>
                        </TD>
                        <TD>
                          {/* Uncontrolled, keyed on the saved value: typing a
                              name would otherwise re-render and re-fetch the whole
                              table on every keystroke. The write is on blur, and
                              the key re-seeds the field once the server answers. */}
                          <Input
                            aria-label={`${r.code} English name`}
                            disabled={rowBusy}
                            key={`${r.owner_id}-name-${r.name}`}
                            defaultValue={r.name}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v && v !== r.name) void patch(r, { name: v });
                            }}
                          />
                        </TD>
                        <TD>
                          <Input
                            aria-label={`${r.code} French name`}
                            disabled={rowBusy}
                            placeholder={r.name}
                            key={`${r.owner_id}-fr-${r.name_fr ?? ""}`}
                            defaultValue={r.name_fr ?? ""}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v !== (r.name_fr ?? "")) void patch(r, { name_fr: v || null });
                            }}
                          />
                        </TD>
                        <TD>
                          <Checkbox
                            checked={!!r.is_internal}
                            disabled={rowBusy}
                            onCheckedChange={(v) => void patch(r, { is_internal: v })}
                            label="Ours"
                            hint="A delay here is charged to us, not to a third party."
                          />
                        </TD>
                        <TD>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              loading={rowBusy}
                              onClick={() => void patch(r, { is_active: off })}
                            >
                              {off ? "Turn on" : "Turn off"}
                            </Button>
                            {!r.is_system && (
                              <Button
                                size="sm"
                                variant="ghost"
                                loading={rowBusy}
                                onClick={() => void remove(r)}
                              >
                                {tr("Delete")}
                              </Button>
                            )}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          )}

          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            <span className="text-sm font-medium text-foreground">Add an owner</span>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Name (English)"
                required
                about="What a person reads: e.g. Shipping line."
              >
                <Input
                  value={draft.name}
                  placeholder="Marine surveyor"
                  onChange={(e) => {
                    const name = e.target.value;
                    setDraft((d) => ({
                      ...d,
                      name,
                      // Follows the name until the code is typed by hand, then
                      // stops — so a deliberate code is never overwritten.
                      code: d.code === codeFromName(d.name) || !d.code ? codeFromName(name) : d.code,
                    }));
                  }}
                />
              </Field>
              <Field label="Name (French)" about="Blank uses the English name.">
                <Input
                  value={draft.name_fr}
                  placeholder="Expert maritime"
                  onChange={(e) => setDraft((d) => ({ ...d, name_fr: e.target.value }))}
                />
              </Field>
              <Field
                label={tr("Code")}
                required
                about="Stored on every stage, and permanent. Uppercase, digits and underscores."
                error={
                  draft.code && !codeOk
                    ? "Uppercase letters, digits and underscores; 2 to 32 characters."
                    : draft.code && !codeFree
                      ? "That code is already in the registry."
                      : undefined
                }
              >
                <Input
                  value={draft.code}
                  placeholder="MARINE_SURVEYOR"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") }))
                  }
                />
              </Field>
              <Field label="What They Do" about="Optional: shown as the dropdown's hint.">
                <Input
                  value={draft.description}
                  placeholder="Draft survey and cargo condition reports."
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                />
              </Field>
            </div>
            <Checkbox
              checked={draft.is_internal}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, is_internal: v }))}
              label="This is one of our own desks"
              about="Tick it only for us. The delay report splits ours from everybody else's on this alone."
            />
            <div className="flex justify-end">
              <Button type="button" loading={busy === "new"} disabled={!canAdd} onClick={() => void add()}>
                Add owner
              </Button>
            </div>
          </div>
        </div>
      </Dialog>
      {confirmDialog}
    </>
  );
}
