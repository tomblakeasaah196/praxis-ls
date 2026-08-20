/**
 * Attendance analytics — PURE.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 *
 * One summarizer behind every attendance number the product shows: the My HR
 * self view, the HR command centre's multi-select history, the Employee 360
 * tab, and the KPI block at the top of the export. They were always going to
 * be asked "why does my punctuality differ from the one HR quoted me?", and
 * the only answer that survives that conversation is "it does not — there is
 * one function".
 *
 * I/O lives in the reconciler and the repo. This takes rows and returns
 * numbers, which is what makes the arithmetic testable against fixtures
 * instead of against a database.
 *
 * ── THE DEFINITIONS, STATED ONCE ────────────────────────────────────────────
 *
 * These are judgement calls, not arithmetic, so they are written down here
 * rather than left implicit in a division:
 *
 *   EXPECTED     PRESENT + LATE + ABSENT. Days the person was owed at work.
 *                ON_LEAVE is NOT expected — approved leave is time the company
 *                agreed they would not be there, and counting it as an expected
 *                day makes a fully-approved holiday look like poor attendance.
 *
 *   DAYS OFF     ON_LEAVE + HOLIDAY + OFF + WEEKEND, per §3.2. One number for
 *                "days the company did not expect you", whatever the reason.
 *
 *   PUNCTUALITY  on-time days as a share of days ATTENDED (PRESENT + LATE),
 *                not of expected days. Absence already has its own KPI beside
 *                this one; folding it in here would report a single figure that
 *                falls for two unrelated reasons and tells you neither. `null`
 *                when nobody attended — a month with no punches has no
 *                punctuality, and 0% would read as "always late".
 *
 *   ON-SITE %    judged punches only. A punch is judged when the geofence
 *                actually returned a verdict (`on_site` / `off_site`); `no_gps`
 *                and `unfenced` are NOT in the denominator, because a tenant
 *                with no worksite defined would otherwise show 0% on-site
 *                forever and learn to ignore the number. `null` when nothing
 *                was judged.
 *
 *   HOURS        only from days that have BOTH a first in and a last out. A
 *                missing clock-out contributes no hours and is counted in
 *                `days_missing_clock_out` instead, so a short total is
 *                explainable rather than merely wrong.
 *
 *   CHARGED      deduction on days that are NOT waived. Waived amounts are kept
 *                and reported separately (`deduction_waived`) because 0697
 *                keeps the figure precisely so the cost of a waiver stays
 *                visible — dropping it here would hide what the waiver forgave.
 */
"use strict";

const { round2 } = require("./attendance.rules");
const { locationStatus } = require("./attendance.location");

/** Days the person was owed at work. */
const EXPECTED = new Set(["PRESENT", "LATE", "ABSENT"]);
/** Days the company did not expect them, whatever the reason. */
const DAYS_OFF = new Set(["ON_LEAVE", "HOLIDAY", "OFF", "WEEKEND"]);

/** pg returns numeric as a string; everything here must survive that. */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Whole hours between two instants, or null when the pair is incomplete. */
function hoursBetween(startAt, endAt) {
  if (!startAt || !endAt) return null;
  const a = new Date(startAt).getTime();
  const b = new Date(endAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return (b - a) / 3600000;
}

function blank() {
  return {
    expected_days: 0,
    attended_days: 0,
    present_days: 0,
    late_days: 0,
    absent_days: 0,
    on_leave_days: 0,
    holiday_days: 0,
    off_days: 0,
    days_off: 0,
    minutes_late: 0,
    hours_worked: 0,
    days_missing_clock_out: 0,
    deduction_charged: 0,
    deduction_waived: 0,
    waived_days: 0,
  };
}

/** Fold one attendance_day row into a totals bucket. */
function addDay(t, d) {
  const status = String(d.status || "").toUpperCase();
  if (EXPECTED.has(status)) t.expected_days += 1;
  if (DAYS_OFF.has(status)) t.days_off += 1;

  if (status === "PRESENT") { t.present_days += 1; t.attended_days += 1; }
  else if (status === "LATE") { t.late_days += 1; t.attended_days += 1; }
  else if (status === "ABSENT") t.absent_days += 1;
  else if (status === "ON_LEAVE") t.on_leave_days += 1;
  else if (status === "HOLIDAY") t.holiday_days += 1;
  else if (status === "OFF" || status === "WEEKEND") t.off_days += 1;

  t.minutes_late += num(d.minutes_late);

  const hours = hoursBetween(d.first_clock_in_at, d.last_clock_out_at);
  if (hours === null) {
    // Only a day somebody actually attended can be missing its clock-out.
    if (status === "PRESENT" || status === "LATE") t.days_missing_clock_out += 1;
  } else {
    t.hours_worked += hours;
  }

  const amount = num(d.deduction_amount);
  if (d.justified) { t.deduction_waived += amount; t.waived_days += 1; }
  else t.deduction_charged += amount;
}

/** Derived rates, computed once at the end so they are never averaged twice. */
function finalize(t, site = { on: 0, judged: 0 }) {
  return {
    ...t,
    hours_worked: round2(t.hours_worked),
    deduction_charged: round2(t.deduction_charged),
    deduction_waived: round2(t.deduction_waived),
    punctuality_pct: t.attended_days ? round2((t.present_days / t.attended_days) * 100) : null,
    on_site_pct: site.judged ? round2((site.on / site.judged) * 100) : null,
    on_site_punches: site.on,
    judged_punches: site.judged,
  };
}

/** on_site / off_site verdicts only — see the header on why. */
function addPunch(site, p) {
  const status = p.location_status || locationStatus(p);
  if (status === "on_site") { site.on += 1; site.judged += 1; }
  else if (status === "off_site") site.judged += 1;
}

const siteBucket = () => ({ on: 0, judged: 0 });

/**
 * Summarize a window.
 *
 * @param {object}   input
 * @param {Array}    input.days     attendance_day rows (joined with employee)
 * @param {Array}    input.punches  attendance_log rows in the same window
 * @param {string}   input.from     ISO date, inclusive
 * @param {string}   input.to       ISO date, inclusive
 */
function summarize({ days = [], punches = [], from = null, to = null } = {}) {
  const totals = blank();
  const site = siteBucket();

  const byEmployee = new Map();
  const byDepartment = new Map();
  const byDate = new Map();

  const employeeOf = (id) => {
    if (!byEmployee.has(id)) {
      byEmployee.set(id, { employee_id: id, employee_name: null, department: null, entity_name: null, totals: blank(), site: siteBucket() });
    }
    return byEmployee.get(id);
  };

  for (const d of days) {
    addDay(totals, d);

    const emp = employeeOf(d.employee_id);
    emp.employee_name = emp.employee_name || d.employee_name || null;
    emp.department = emp.department || d.department || null;
    emp.entity_name = emp.entity_name || d.entity_name || null;
    addDay(emp.totals, d);

    const dept = d.department || "—";
    if (!byDepartment.has(dept)) byDepartment.set(dept, { department: dept, employees: new Set(), totals: blank(), site: siteBucket() });
    const dep = byDepartment.get(dept);
    dep.employees.add(d.employee_id);
    addDay(dep.totals, d);

    /*
     * Heatmap cells are keyed by DATE and aggregated across whoever is in the
     * window. One employee gives one cell a day, which is the My HR calendar;
     * a selected set gives the HR view a density per day. Same cell shape for
     * both so the widget does not need two renderers.
     */
    const key = d.work_date instanceof Date ? d.work_date.toISOString().slice(0, 10) : String(d.work_date).slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, { date: key, ...blank() });
    addDay(byDate.get(key), d);
  }

  /*
   * Punches are attributed to the employee bucket when we know them, and always
   * to the tenant-wide figure. A punch whose employee is not in `days` (the
   * night the reconciler has not run yet) still counts toward on-site %: the
   * question "were people where they said they were" does not wait on
   * reconciliation.
   */
  for (const p of punches) {
    addPunch(site, p);
    if (p.employee_id && byEmployee.has(p.employee_id)) addPunch(byEmployee.get(p.employee_id).site, p);
    const dept = p.department || null;
    if (dept && byDepartment.has(dept)) addPunch(byDepartment.get(dept).site, p);
  }

  return {
    window: { from, to },
    totals: finalize(totals, site),
    by_employee: [...byEmployee.values()]
      .map((e) => ({
        employee_id: e.employee_id,
        employee_name: e.employee_name,
        department: e.department,
        entity_name: e.entity_name,
        ...finalize(e.totals, e.site),
      }))
      .sort((a, b) => String(a.employee_name || "").localeCompare(String(b.employee_name || ""))),
    by_department: [...byDepartment.values()]
      .map((d) => ({ department: d.department, employees: d.employees.size, ...finalize(d.totals, d.site) }))
      .sort((a, b) => String(a.department).localeCompare(String(b.department))),
    heatmap: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

module.exports = { summarize, hoursBetween, EXPECTED, DAYS_OFF };
