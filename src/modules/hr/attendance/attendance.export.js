/**
 * Attendance export — payroll-shaped Days and Punches.
 *
 * ── THE COLUMN KEYS ARE A CONTRACT ──────────────────────────────────────────
 *
 * §3.5 calls this "payroll-ready", which means somebody downstream builds a
 * payroll run off these headers. Renaming or reordering a key is therefore a
 * breaking change to a consumer this repo cannot see, so the two column lists
 * are exported and pinned by a test. Add to the end; do not rename in place.
 *
 * ── TYPED CELLS, NOT PRE-FORMATTED STRINGS ─────────────────────────────────
 *
 * Columns declare a `format` and the rows carry RAW values — instants, numbers,
 * booleans. `services/spreadsheet` then coerces each one against the tenant's
 * WorkbookContext, which is what makes a date land in the entity's timezone,
 * money carry the tenant's currency and decimals, and "Yes"/"No" follow the
 * tenant's language. Formatting them here would hardcode all three, and the
 * guide's own §5 instruction (export via the Maroon `excel/workbook.js`) was
 * exactly that mistake — that module has since been deleted and replaced by
 * the brand-aware service this composes.
 *
 * ── A REPORT, NOT A PAGE (§6.7) ─────────────────────────────────────────────
 *
 * The row cap lives in the repo (MAX_REPORT_ROWS) and is applied by the reads.
 * `truncated` is reported back so a caller can say "this file is the first
 * 20,000 rows" rather than hand over a silent prefix of the truth.
 */
"use strict";

const { buildWorkbook, buildCsv } = require("../../../services/spreadsheet");
const { round2 } = require("./attendance.rules");
const { locationStatus } = require("./attendance.location");
const { hoursBetween, EXPECTED } = require("./attendance.analytics");
const repo = require("./attendance.repo");

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** ISO date of a `date` column, which pg may hand back as a Date or a string. */
function isoDay(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function weekdayName(value) {
  const iso = isoDay(value);
  if (!iso) return "";
  const at = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? "" : WEEKDAYS[at.getUTCDay()];
}

/** Days sheet — one row per reconciled day. Keys are the payroll contract. */
const DAY_COLUMNS = [
  { header: "Employee", key: "employee", width: 26 },
  { header: "Department", key: "department", width: 18 },
  { header: "Entity", key: "entity", width: 22 },
  { header: "Work date", key: "work_date", width: 12, format: "date" },
  { header: "Weekday", key: "weekday", width: 11 },
  { header: "Expected", key: "expected", width: 10, format: "bool" },
  { header: "Status", key: "status", width: 11 },
  { header: "Expected start", key: "expected_start", width: 13 },
  { header: "First in", key: "first_in", width: 18, format: "datetime" },
  { header: "Last out", key: "last_out", width: 18, format: "datetime" },
  { header: "Hours", key: "hours", width: 9, format: "num" },
  { header: "Minutes late", key: "minutes_late", width: 13, format: "int" },
  { header: "On site", key: "on_site", width: 12 },
  { header: "Location", key: "geo_label", width: 26 },
  { header: "Device", key: "device_label", width: 20 },
  { header: "Device trusted", key: "device_trusted", width: 14, format: "bool" },
  { header: "Deduction", key: "deduction", width: 13, format: "money" },
  { header: "Waived", key: "waived", width: 9, format: "bool" },
  { header: "Justification", key: "justification", width: 30 },
  { header: "Leave type", key: "leave_type", width: 14 },
  { header: "Rule", key: "rule_code", width: 12 },
];

/** Punches sheet — one row per punch, including days never reconciled. */
const PUNCH_COLUMNS = [
  { header: "Employee", key: "employee", width: 26 },
  { header: "Clock in", key: "clock_in", width: 18, format: "datetime" },
  { header: "Clock out", key: "clock_out", width: 18, format: "datetime" },
  // Coordinates stay text: every numeric format the service offers rounds to
  // at most three places, and a punch location truncated to 4.050 is a
  // different building.
  { header: "Latitude", key: "lat", width: 12 },
  { header: "Longitude", key: "lng", width: 12 },
  { header: "Within geofence", key: "within_geofence", width: 15, format: "bool" },
  { header: "Location", key: "geo_label", width: 26 },
  { header: "Distance (m)", key: "distance_m", width: 13, format: "int" },
  { header: "Device", key: "device", width: 20 },
  { header: "Late", key: "late", width: 8, format: "bool" },
];

/**
 * `on_site` on a Days row is the verdict of the punch that OPENED the day.
 *
 * Not a re-derivation from `within_geofence` alone: PR1's `location_status`
 * exists precisely because null there means two different things, and payroll
 * asking "were they on site" must not read "we never got a fix" as "no".
 */
function dayOnSite(d) {
  const status = locationStatus(d);
  if (status === "on_site") return "Yes";
  if (status === "off_site") return "No";
  if (status === "no_gps") return "No GPS";
  return "No worksite";
}

function dayRow(d) {
  const hours = hoursBetween(d.first_clock_in_at, d.last_clock_out_at);
  return {
    employee: d.employee_name || "",
    department: d.department || "",
    entity: d.entity_name || "",
    work_date: d.work_date || null,
    weekday: weekdayName(d.work_date),
    expected: EXPECTED.has(String(d.status || "").toUpperCase()),
    status: d.status || "",
    expected_start: d.expected_start_time || "",
    first_in: d.first_clock_in_at || null,
    last_out: d.last_clock_out_at || null,
    hours: hours === null ? null : round2(hours),
    minutes_late: Number(d.minutes_late) || 0,
    on_site: dayOnSite(d),
    geo_label: d.geo_label || "",
    device_label: d.device_label || "",
    device_trusted: d.device_trusted === null || d.device_trusted === undefined ? null : d.device_trusted,
    deduction: Number(d.deduction_amount) || 0,
    waived: !!d.justified,
    justification: d.justification || "",
    leave_type: d.leave_type || "",
    rule_code: d.rule_code || "",
  };
}

function punchRow(p) {
  return {
    employee: p.employee_name || "",
    clock_in: p.clock_in_at || null,
    clock_out: p.clock_out_at || null,
    lat: p.latitude === null || p.latitude === undefined ? "" : String(p.latitude),
    lng: p.longitude === null || p.longitude === undefined ? "" : String(p.longitude),
    within_geofence: p.within_geofence === null || p.within_geofence === undefined ? null : p.within_geofence,
    geo_label: p.geo_label || "",
    distance_m: p.distance_m === null || p.distance_m === undefined ? null : Number(p.distance_m),
    device: p.device_label || "",
    late: !!p.is_late,
  };
}

/** `attendance-2026-08-01-2026-08-31.xlsx` — the window is in the filename. */
function filename(from, to, ext) {
  return `attendance-${isoDay(from)}-${isoDay(to)}.${ext}`;
}

/**
 * Build the export.
 *
 * @param {object} input
 * @param {Array}  input.days      rows from `reconcile.daysFor`
 * @param {Array}  input.punches   rows from `repo.punchesInRange`
 * @param {object} input.context   WorkbookContext from `resolveContext`, which
 *                                 carries the tenant brand, base currency and
 *                                 entity timezone. Omitted only in unit tests —
 *                                 shipping unbranded output because a caller
 *                                 skipped it is a bug, per the service contract.
 * @param {string} input.format    "xlsx" | "csv"
 * @param {string} input.sheet     CSV only: "days" (default) | "punches"
 */
async function build({ days = [], punches = [], from, to, context = null, format = "xlsx", sheet = "days" } = {}) {
  const dayRows = days.map(dayRow);
  const punchRows = punches.map(punchRow);
  const truncated = days.length >= repo.MAX_REPORT_ROWS || punches.length >= repo.MAX_REPORT_ROWS;

  if (format === "csv") {
    // CSV is one table by definition, so the caller picks which one.
    const punchesWanted = String(sheet).toLowerCase() === "punches";
    return {
      buffer: buildCsv({
        columns: punchesWanted ? PUNCH_COLUMNS : DAY_COLUMNS,
        rows: punchesWanted ? punchRows : dayRows,
        context,
      }),
      filename: filename(from, to, "csv"),
      contentType: "text/csv; charset=utf-8",
      truncated,
    };
  }

  return {
    buffer: await buildWorkbook({
      sheets: [
        { name: "Days", columns: DAY_COLUMNS, rows: dayRows },
        { name: "Punches", columns: PUNCH_COLUMNS, rows: punchRows },
      ],
      context,
    }),
    filename: filename(from, to, "xlsx"),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    truncated,
  };
}

module.exports = { build, DAY_COLUMNS, PUNCH_COLUMNS, dayRow, punchRow, filename };
