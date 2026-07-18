/**
 * Governance — audit ledger, notifications, the workflow ENGINE (definitions +
 * ordered validate/approve step chains), and the runtime approvals queue.
 */
import * as React from "react";
import { ResourceList } from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { useList, useResource, errMsg } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { money, num, dateFmt } from "@/lib/format";
import * as wf from "@/lib/workflow-api";

export const AuditPage = () => (
  <ResourceList
    title="Audit ledger"
    description="Append-only trail — every create/lock/post/reverse, permission and AI action. Read-only by design."
    endpoint="/audit"
    columns={[
      { key: "action", label: "Action" },
      { key: "module_key", label: "Module" },
      { key: "entity_ref", label: "Entity" },
      { key: "actor_user_id", label: "Actor" },
      { key: "created_at", label: "When" },
    ]}
  />
);

export const NotificationsPage = () => (
  <ResourceList
    title="Notifications"
    description="Watch-the-Watcher writes HIGH alerts here for CEO/Management on security-critical changes."
    endpoint="/notifications"
    columns={[
      { key: "priority", label: "Priority" },
      { key: "title", label: "Title" },
      { key: "event_type_key", label: "Event" },
      { key: "created_at", label: "When" },
    ]}
  />
);

/* ═══════════════════ Workflows — definitions + step chains ═══════════════════ */
function Toggle({ on, busy, onClick }: { on: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={busy} role="switch" aria-checked={on}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-[rgb(var(--ink-3)/0.3)]"} ${busy ? "opacity-60" : ""}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function band(s: wf.WorkflowStep): string {
  if (s.min_amount_xaf == null && s.max_amount_xaf == null) return "any amount";
  if (s.min_amount_xaf != null && s.max_amount_xaf != null) return `${money(s.min_amount_xaf)} – ${money(s.max_amount_xaf)}`;
  if (s.min_amount_xaf != null) return `≥ ${money(s.min_amount_xaf)}`;
  return `≤ ${money(s.max_amount_xaf)}`;
}

function StepForm({ workflowId, nextSeq, onClose, onSaved }: { workflowId: string; nextSeq: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = React.useState({ step_seq: String(nextSeq), step_kind: "APPROVE", capability_code: "APPROVER", min_amount_xaf: "", max_amount_xaf: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await wf.addStep(workflowId, {
        step_seq: Number(f.step_seq), step_kind: f.step_kind as "VALIDATE" | "APPROVE",
        capability_code: f.capability_code as "VALIDATOR" | "APPROVER",
        min_amount_xaf: f.min_amount_xaf === "" ? undefined : Number(f.min_amount_xaf),
        max_amount_xaf: f.max_amount_xaf === "" ? undefined : Number(f.max_amount_xaf),
      });
      onSaved(); onClose();
    } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Add step" description="A stage in the chain — who acts, and (optionally) the amount band it applies to.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Order" required><Input type="number" min="1" className="num" value={f.step_seq} onChange={(e) => set("step_seq", e.target.value)} /></Field>
          <Field label="Kind" required>
            <Select value={f.step_kind} onChange={(e) => { set("step_kind", e.target.value); set("capability_code", e.target.value === "VALIDATE" ? "VALIDATOR" : "APPROVER"); }}>
              <option value="VALIDATE">Validate</option>
              <option value="APPROVE">Approve</option>
            </Select>
          </Field>
          <Field label="Capability" required>
            <Select value={f.capability_code} onChange={(e) => set("capability_code", e.target.value)}>
              <option value="VALIDATOR">Validator</option>
              <option value="APPROVER">Approver</option>
            </Select>
          </Field>
          <div />
          <Field label="Min amount (XAF)"><Input type="number" min="0" className="num text-right" value={f.min_amount_xaf} onChange={(e) => set("min_amount_xaf", e.target.value)} placeholder="Any" /></Field>
          <Field label="Max amount (XAF)"><Input type="number" min="0" className="num text-right" value={f.max_amount_xaf} onChange={(e) => set("max_amount_xaf", e.target.value)} placeholder="Any" /></Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={busy}>Add step</Button>
        </div>
      </form>
    </Modal>
  );
}

function WorkflowDrawer({ workflow, onClose, onChanged }: { workflow: wf.Workflow; onClose: () => void; onChanged: () => void }) {
  const steps = useResource(() => wf.listSteps(workflow.workflow_id), [workflow.workflow_id]);
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const chain = (steps.data || []).slice().sort((a, b) => a.step_seq - b.step_seq);
  const nextSeq = chain.length ? Math.max(...chain.map((s) => s.step_seq)) + 1 : 1;

  async function remove(s: wf.WorkflowStep) {
    setBusy(s.workflow_step_id);
    try { await wf.removeStep(workflow.workflow_id, s.workflow_step_id); steps.reload(); onChanged(); } finally { setBusy(null); }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={workflow.name} description={workflow.event_type_key ? `On event: ${workflow.event_type_key}` : undefined}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="micro uppercase tracking-wide">Approval chain</span>
          <Button size="sm" onClick={() => setAdding(true)}>Add step</Button>
        </div>
        {steps.loading ? <div className="py-6 text-center micro">Loading…</div> : steps.error ? <ErrorState message={errMsg(steps.error)} /> : chain.length ? (
          <ol className="space-y-2">
            {chain.map((s) => (
              <li key={s.workflow_step_id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="flex items-center gap-3">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-[rgb(var(--primary))]">{s.step_seq}</span>
                  <Pill tone={s.step_kind === "VALIDATE" ? "blue" : "ok"}>{s.step_kind}</Pill>
                  <span className="text-sm">{s.capability_code || "role"}</span>
                  <span className="micro">· {band(s)}</span>
                </span>
                <Button size="sm" variant="ghost" loading={busy === s.workflow_step_id} onClick={() => remove(s)}>Remove</Button>
              </li>
            ))}
          </ol>
        ) : <p className="micro">No steps yet — add the first stage of the chain.</p>}
      </div>
      {adding && <StepForm workflowId={workflow.workflow_id} nextSeq={nextSeq} onClose={() => setAdding(false)} onSaved={() => { steps.reload(); onChanged(); }} />}
    </Modal>
  );
}

function WorkflowForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { rows: events } = useList<wf.EventType>("/event-types");
  const approvable = (events || []).filter((e) => e.is_approvable);
  const [f, setF] = React.useState({ name: "", event_type_key: "" });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await wf.createWorkflow({ name: f.name, event_type_key: f.event_type_key }); onSaved(); onClose(); }
    catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="New workflow" description="Bind an approval chain to an approvable event.">
      <form className="space-y-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Expense approval over 500k" /></Field>
          <Field label="Event" required className="sm:col-span-2">
            <Select value={f.event_type_key} onChange={(e) => set("event_type_key", e.target.value)}>
              <option value="">Select an approvable event…</option>
              {approvable.map((e) => <option key={e.key} value={e.key}>{e.name || e.key}</option>)}
            </Select>
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!f.name || !f.event_type_key || busy}>Create workflow</Button>
        </div>
      </form>
    </Modal>
  );
}

export function WorkflowsPage() {
  const { rows, error, loading, reload } = useList<wf.Workflow>("/workflows");
  const [creating, setCreating] = React.useState(false);
  const [view, setView] = React.useState<wf.Workflow | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const list = rows || [];

  async function toggleActive(w: wf.Workflow) {
    setBusy(w.workflow_id);
    try { await wf.updateWorkflow(w.workflow_id, { is_active: !w.is_active }); reload(); } finally { setBusy(null); }
  }

  const columns: Column<wf.Workflow>[] = [
    { key: "name", label: "Workflow", render: (w) => <span className="font-medium text-foreground">{w.name}</span> },
    { key: "event", label: "On event", render: (w) => (w.event_type_key ? <Pill tone="mute">{w.event_type_key}</Pill> : "—") },
    { key: "steps", label: "Steps", className: "num text-right", render: (w) => num(w.step_count ?? 0) },
    { key: "active", label: "Active", render: (w) => <Toggle on={!!w.is_active} busy={busy === w.workflow_id} onClick={() => toggleActive(w)} /> },
    { key: "_a", label: "", render: (w) => <div className="flex justify-end" onClick={(e) => e.stopPropagation()}><Button size="sm" variant="outline" onClick={() => setView(w)}>Edit chain</Button></div> },
  ];

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <PageHeader title="Workflows" description="Validate/approve chains bound to approvable events — the org's approval routing." action={<Button onClick={() => setCreating(true)}>New workflow</Button>} />
      <KpiRow>
        <KpiTile label="Workflows" value={num(list.length)} />
        <KpiTile label="Active" value={num(list.filter((w) => w.is_active).length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(w) => w.workflow_id} onRowClick={(w) => setView(w)} empty={{ title: "No workflows", hint: "Create a chain to route approvals for an event." }} />
      {creating && <WorkflowForm onClose={() => setCreating(false)} onSaved={reload} />}
      {view && <WorkflowDrawer workflow={view} onClose={() => setView(null)} onChanged={reload} />}
    </section>
  );
}

/* ═══════════════════════ Approvals — runtime queue ═══════════════════════ */
type ApprovalTask = {
  approval_task_id?: string; id?: string; entity_ref?: string | null; status?: string | null;
  step_kind?: string | null; amount_xaf?: number | string | null; workflow_name?: string | null; created_at?: string | null;
};
const actTone = (s?: string | null): Tone => {
  const u = String(s || "").toUpperCase();
  if (u === "APPROVED" || u === "VALIDATED") return "ok";
  if (u === "REJECTED") return "bad";
  if (u === "PENDING") return "warn";
  return "mute";
};

export function ApprovalsPage() {
  const { rows, error, loading, reload } = useList<ApprovalTask>("/approvals?status=PENDING");
  const [busy, setBusy] = React.useState<string | null>(null);
  const list = rows || [];
  const idOf = (r: ApprovalTask) => String(r.approval_task_id || r.id || "");

  async function act(r: ApprovalTask, action: "validate" | "approve" | "reject") {
    const id = idOf(r);
    if (!id) return;
    const note = action === "reject" ? window.prompt("Reason for rejection (optional):") ?? undefined : undefined;
    setBusy(id + action);
    try { await tenant(`/approvals/${id}/act`, { method: "POST", body: { action, note } }); reload(); }
    catch (e) { alert(errMsg(e)); } finally { setBusy(null); }
  }

  const columns: Column<ApprovalTask>[] = [
    { key: "entity_ref", label: "Entity", render: (r) => <span className="num font-medium text-foreground">{r.entity_ref || "—"}</span> },
    { key: "workflow", label: "Workflow", render: (r) => r.workflow_name || "—" },
    { key: "stage", label: "Stage", render: (r) => (r.step_kind ? <Pill tone="blue">{r.step_kind}</Pill> : "—") },
    { key: "amount", label: "Amount · XAF", className: "num text-right", render: (r) => money(r.amount_xaf) },
    { key: "created", label: "Raised", render: (r) => dateFmt(r.created_at) },
    { key: "status", label: "Status", render: (r) => <Pill tone={actTone(r.status)}>{r.status || "PENDING"}</Pill> },
    {
      key: "_a", label: "", render: (r) => {
        const id = idOf(r);
        return (
          <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            {r.step_kind === "VALIDATE" && <Button size="sm" variant="outline" loading={busy === id + "validate"} onClick={() => act(r, "validate")}>Validate</Button>}
            <Button size="sm" loading={busy === id + "approve"} onClick={() => act(r, "approve")}>Approve</Button>
            <Button size="sm" variant="outline" loading={busy === id + "reject"} onClick={() => act(r, "reject")}>Reject</Button>
          </div>
        );
      },
    },
  ];

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <PageHeader title="Approvals" description="Your runtime approval queue — validate or approve/reject items routed to you by workflow." />
      <KpiRow>
        <KpiTile label="Pending" value={num(list.length)} />
        <KpiTile label="To validate" value={num(list.filter((r) => r.step_kind === "VALIDATE").length)} />
        <KpiTile label="To approve" value={num(list.filter((r) => r.step_kind === "APPROVE").length)} />
      </KpiRow>
      <DataList columns={columns} rows={rows} error={error} loading={loading} rowKey={(r) => idOf(r)} empty={{ title: "Nothing awaiting you", hint: "Items needing your validation or approval land here." }} />
    </section>
  );
}
