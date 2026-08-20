/**
 * Attendance history — the shared widget.
 *
 * ── ONE WIDGET, THREE MOUNTS ────────────────────────────────────────────────
 *
 * My HR (your own record), HR Attendance → History (a selected set), and the
 * Employee 360 tab (one person). §3.2/§3.3 describe them as three screens, but
 * they ask one question over one window and they must answer it identically —
 * the day an employee's punctuality here disagrees with the figure their
 * manager quotes, both numbers stop being believed. So there is one component
 * and one summarizer behind it; `scope` only decides which endpoint it calls
 * and whether waiving is offered.
 *
 * ── WHY TWO REQUESTS ────────────────────────────────────────────────────────
 *
 * Analytics gives the KPI strip, the heatmap and the per-employee compare rows;
 * the day rows come from `/days`. They are separate because the table is a
 * scrollable list of a window that can hold 18,000 rows, and the KPI strip must
 * describe the WHOLE window rather than whatever page of it is on screen. One
 * combined response would force those two to be the same set.
 *
 * ── NULL IS NOT ZERO ────────────────────────────────────────────────────────
 *
 * `punctuality_pct` and `on_site_pct` are null when there is no basis to judge
 * — nobody attended, or no punch was ever judged against a worksite. They
 * render as "—". Painting them 0% is how a screen tells a confident lie about
 * somebody's record.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Callout } from "@/components/ui/callout";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, dateFmt, num as fmtNum } from "@/lib/format";
import { reportActionError } from "@/lib/action-error";
import { cn } from "@/lib/cn";
import * as api from "@/lib/hr-api";
import { WaiveModal } from "./attendance-waive";
import { STATUS_TONE } from "./attendance-status";
import {
  periodFor, windowError, PERIOD_LABELS,
  type Period, type PeriodKey,
} from "./attendance-period";

/** Which record is on screen, and therefore which endpoint and which powers. */
export type HistoryScope =
  | { kind: "mine" }
  | { kind: "employee"; employeeId: string }
  | { kind: "hr" };

const PERIOD_CHIPS: PeriodKey[] = ["7d", "month", "quarter", "year", "custom"];
const numOf = (v: unknown) => (v == null ? 0 : Number(v));

/** A percentage that may have no basis. See the header. */
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${fmtNum(v)}%`;

/** Minutes as "3h 20m" — payroll thinks in hours once past an hour. */
function minutes(total: number) {
  const m = Math.round(numOf(total));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* ── Heatmap ──────────────────────────────────────────────────────────────
 *
 * Expected working days only carry a tone; days off are drawn but muted, so
 * the shape of the week is visible and a Mon–Sat yard looks different from a
 * Mon–Fri office. That distinction is the whole point of PR1's calendar work,
 * and a heatmap that hid it would undo the fix visually.
 */
function heatTone(c: api.AttendanceHeatCell): string {
  if (c.absent_days > 0) return "bg-[var(--bad)]/70";
  if (c.late_days > 0) return "bg-[var(--warn)]/70";
  if (c.present_days > 0) return "bg-[var(--ok)]/70";
  if (c.on_leave_days > 0) return "bg-[var(--info)]/40";
  return "bg-muted";
}

function heatTitle(c: api.AttendanceHeatCell): string {
  const bits: string[] = [dateFmt(c.date)];
  if (c.present_days) bits.push(`${c.present_days} on time`);
  if (c.late_days) bits.push(`${c.late_days} late (${minutes(c.minutes_late)})`);
  if (c.absent_days) bits.push(`${c.absent_days} absent`);
  if (c.on_leave_days) bits.push(`${c.on_leave_days} on leave`);
  if (c.holiday_days) bits.push("holiday");
  if (!c.expected_days && !c.on_leave_days && !c.holiday_days) bits.push("not a working day");
  return bits.join(" · ");
}

function Heatmap({ cells }: { cells: api.AttendanceHeatCell[] }) {
  if (!cells.length) return null;
  return (
    <div className="mb-4 rounded-[10px] border bg-card p-3 shadow-[var(--shadow-s)]">
      <div className="micro mb-2 text-muted-foreground">{tr("Working days in this window")}</div>
      <div className="flex flex-wrap gap-1">
        {cells.map((c) => (
          <span
            key={c.date}
            title={heatTitle(c)}
            aria-label={heatTitle(c)}
            className={cn("h-4 w-4 rounded-[3px]", heatTone(c))}
          />
        ))}
      </div>
    </div>
  );
}

/* ── KPI strip ─────────────────────────────────────────────────────────── */
function Kpis({ t }: { t: api.AttendanceTotals }) {
  return (
    <KpiRow>
      <KpiTile label={tr("Punctuality")} value={pct(t.punctuality_pct)} hint={`${t.present_days}/${t.attended_days} ${tr("on time")}`} tone={t.late_days ? "warn" : "ok"} />
      <KpiTile label={tr("Hours worked")} value={fmtNum(t.hours_worked)} hint={t.days_missing_clock_out ? `${t.days_missing_clock_out} ${tr("missing clock-out")}` : undefined} />
      <KpiTile label={tr("Late")} value={String(t.late_days)} hint={minutes(t.minutes_late)} tone={t.late_days ? "warn" : "accent"} />
      <KpiTile label={tr("Absent")} value={String(t.absent_days)} tone={t.absent_days ? "bad" : "accent"} />
      <KpiTile label={tr("On site")} value={pct(t.on_site_pct)} hint={t.judged_punches ? `${t.on_site_punches}/${t.judged_punches} ${tr("punches")}` : tr("no worksite")} />
      <KpiTile label={tr("Days off")} value={String(t.days_off)} hint={`${t.on_leave_days} ${tr("leave")} · ${t.holiday_days} ${tr("holiday")}`} />
    </KpiRow>
  );
}

/* ── Compare table (HR only) ───────────────────────────────────────────── */
function Compare({ rows }: { rows: api.AttendanceEmployeeTotals[] }) {
  if (rows.length < 2) return null;
  return (
    <div className="mb-4 overflow-x-auto">
      <Table>
        <THead>
          <TR>
            <TH>{tr("Employee")}</TH>
            <TH>{tr("Department")}</TH>
            <TH>{tr("Punctuality")}</TH>
            <TH>{tr("Late")}</TH>
            <TH>{tr("Absent")}</TH>
            <TH>{tr("Hours")}</TH>
            <TH>{tr("Charged")}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.employee_id}>
              <TD>{r.employee_name || "—"}</TD>
              <TD>{r.department || "—"}</TD>
              <TD>{pct(r.punctuality_pct)}</TD>
              <TD>{r.late_days}</TD>
              <TD>{r.absent_days}</TD>
              <TD>{fmtNum(r.hours_worked)}</TD>
              <TD>{money(r.deduction_charged)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

/* ── The widget ────────────────────────────────────────────────────────── */
export function AttendanceHistory({
  scope,
  className,
}: {
  scope: HistoryScope;
  className?: string;
}) {
  const [periodKey, setPeriodKey] = React.useState<PeriodKey>("month");
  const [win, setWin] = React.useState<Period>(() => periodFor("month"));
  const [department, setDepartment] = React.useState("");
  const [waiving, setWaiving] = React.useState<api.AttendanceDay | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [downloading, setDownloading] = React.useState(false);

  const isMine = scope.kind === "mine";
  // Waiving moves money off a payslip; it is never offered on your own record.
  const canWaive = scope.kind !== "mine";
  const employeeId = scope.kind === "employee" ? scope.employeeId : undefined;
  const dept = scope.kind === "hr" && department.trim() ? department.trim() : undefined;

  function choose(key: PeriodKey) {
    setPeriodKey(key);
    if (key !== "custom") setWin(periodFor(key));
  }

  const invalid = windowError(win);

  const analytics = useResource(
    () =>
      invalid
        ? Promise.resolve(null)
        : isMine
          ? api.myAttendanceAnalytics(win)
          : api.attendanceAnalytics({ ...win, employee_id: employeeId, department: dept }),
    [win.from, win.to, employeeId, dept, isMine, invalid],
  );

  const days = useResource(
    () =>
      invalid
        ? Promise.resolve([])
        : isMine
          ? api.myAttendanceDays(win)
          : api.attendanceDays({ ...win, employee_id: employeeId }),
    [win.from, win.to, employeeId, isMine, invalid],
  );

  async function download(format: "xlsx" | "csv") {
    setDownloading(true);
    try {
      if (isMine) await api.downloadMyAttendanceExport({ ...win, format });
      else await api.downloadAttendanceExport({ ...win, employee_id: employeeId, department: dept, format });
    } catch (e) {
      reportActionError(e);
    } finally {
      setDownloading(false);
    }
  }

  /*
   * The honest empty state (carried over from the reconciled-days view it
   * replaces). An empty table reads as "nobody was late", which is the one
   * wrong answer — so when the window has no rows we say the days have not been
   * reconciled and offer to run the pass. Never offered on your own record:
   * re-running reconciliation is an `edit` grant, not something an employee
   * does to their own attendance.
   */
  async function reconcileNow() {
    setBusy("reconcile");
    try {
      await api.runReconcile(win.to);
      days.reload();
      analytics.reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusy(null);
    }
  }

  async function uphold(day: api.AttendanceDay) {
    setBusy(day.attendance_day_id);
    try {
      await api.justifyDay(day.attendance_day_id, { justified: false });
      days.reload();
      analytics.reload();
    } catch (e) {
      reportActionError(e);
    } finally {
      setBusy(null);
    }
  }

  const totals = analytics.data?.totals;
  const rows = days.data || [];

  return (
    <div className={className}>
      {/* Period + export */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Segmented
          label={tr("Period")}
          value={periodKey}
          onChange={choose}
          options={PERIOD_CHIPS.map((k) => ({ value: k, label: tr(PERIOD_LABELS[k]) }))}
        />
        {periodKey === "custom" && (
          <div className="flex items-end gap-2">
            <label className="micro text-muted-foreground">
              {tr("From")}
              <Input type="date" value={win.from} onChange={(e) => setWin((w) => ({ ...w, from: e.target.value }))} />
            </label>
            <label className="micro text-muted-foreground">
              {tr("To")}
              <Input type="date" value={win.to} onChange={(e) => setWin((w) => ({ ...w, to: e.target.value }))} />
            </label>
          </div>
        )}
        {scope.kind === "hr" && (
          <label className="micro text-muted-foreground">
            {tr("Department")}
            <Input
              value={department}
              placeholder={tr("All departments")}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </label>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" disabled={!!invalid || downloading} onClick={() => void download("csv")}>
            {tr("CSV")}
          </Button>
          <Button variant="outline" disabled={!!invalid || downloading} onClick={() => void download("xlsx")}>
            {tr("Excel")}
          </Button>
        </div>
      </div>

      {invalid && <Callout tone="warn">{tr(invalid)}</Callout>}

      {!invalid && analytics.error && (
        <ErrorState
          message={errMsg(analytics.error)}
          action={<Button variant="outline" onClick={analytics.reload}>{tr("Retry")}</Button>}
        />
      )}
      {!invalid && analytics.loading && <LoadingRow label={tr("Loading…")} />}

      {!invalid && totals && (
        <>
          <Kpis t={totals} />
          <Heatmap cells={analytics.data?.heatmap || []} />
          {scope.kind === "hr" && <Compare rows={analytics.data?.by_employee || []} />}
        </>
      )}

      {/* The day table. Leave, holidays and non-working days are rows, not gaps. */}
      {!invalid && days.error && (
        <ErrorState
          message={errMsg(days.error)}
          action={<Button variant="outline" onClick={days.reload}>{tr("Retry")}</Button>}
        />
      )}
      {!invalid && !days.loading && !rows.length && (
        <EmptyState
          title={tr("These days have not been reconciled")}
          hint={tr("Reconciliation runs on completed days, so today is never here yet.")}
          action={
            canWaive ? (
              <Button loading={busy === "reconcile"} onClick={() => void reconcileNow()}>
                {tr("Run reconciliation")}
              </Button>
            ) : undefined
          }
        />
      )}
      {!!rows.length && (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>{tr("Date")}</TH>
                {scope.kind === "hr" && <TH>{tr("Employee")}</TH>}
                <TH>{tr("Status")}</TH>
                <TH>{tr("In")}</TH>
                <TH>{tr("Out")}</TH>
                <TH>{tr("Late")}</TH>
                <TH>{tr("Deduction")}</TH>
                {canWaive && <TH>{tr("Action")}</TH>}
              </TR>
            </THead>
            <TBody>
              {rows.map((d) => {
                const charged = numOf(d.deduction_amount) > 0;
                return (
                  <TR key={d.attendance_day_id}>
                    <TD>{dateFmt(d.work_date)}</TD>
                    {scope.kind === "hr" && <TD>{d.employee_name || "—"}</TD>}
                    <TD>
                      <Pill tone={STATUS_TONE[d.status] || "mute"}>{tr(d.status)}</Pill>
                    </TD>
                    <TD>{d.first_clock_in_at ? dateFmt(d.first_clock_in_at) : "—"}</TD>
                    <TD>{d.last_clock_out_at ? dateFmt(d.last_clock_out_at) : "—"}</TD>
                    <TD>{d.minutes_late ? minutes(d.minutes_late) : "—"}</TD>
                    <TD>
                      {charged ? money(d.deduction_amount) : "—"}
                      {d.justified && charged && (
                        <span className="micro ml-1 text-muted-foreground">{tr("waived")}</span>
                      )}
                    </TD>
                    {canWaive && (
                      <TD>
                        {charged &&
                          (d.justified ? (
                            <Button
                              variant="ghost"
                              disabled={busy === d.attendance_day_id}
                              onClick={() => void uphold(d)}
                            >
                              {tr("Uphold")}
                            </Button>
                          ) : (
                            <Button variant="ghost" onClick={() => setWaiving(d)}>
                              {tr("Waive")}
                            </Button>
                          ))}
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}

      {waiving && (
        <WaiveModal
          day={waiving}
          onClose={() => setWaiving(null)}
          onSaved={() => {
            setWaiving(null);
            days.reload();
            analytics.reload();
          }}
        />
      )}
    </div>
  );
}

export default AttendanceHistory;
