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
 * ── WHICH WORKBOOK TOOLKIT ──────────────────────────────────────────────────
 *
 * `services/spreadsheet.service`, NOT `services/excel/workbook.js`.
 *
 * The engineering guide (§5 PR2, §6.10) says to reuse `excel/workbook.js` for
 * its Maroon header. That module cannot be loaded: it requires
 * `../../utils/dates`, and `src/utils/` holds only `errors.js` and
 * `data-url.js`, so the `require` throws before any of its styling runs.
 * `assistant.export.js` already recorded this after hitting it. Its number
 * formats are also another product's — ₦ Naira, where this product bills in
 * XAF. `spreadsheet.service` is the live builder the catalogue import/export
 * engine uses, and it is what this module composes.
 *
 * ── A REPORT, NOT A PAGE (§6.7) ─────────────────────────────────────────────
 *
 * The row cap lives in the repo (MAX_REPORT_ROWS) and is applied by the reads.
 * `truncated` is reported back so a caller can say "this file is the first
 * 20,000 rows" rather than hand over a silent prefix of the truth.
 */
"use strict";

const { buildWorkbook, buildCsv } = require("../../../services/spreadsheet.service");
const { round2, wallClock } = require("./attendance.rules");
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

/** "YYYY-MM-DD HH:MM" in the workplace zone — payroll reads local time. */
function localStamp(instant, timeZone) {
  if (!instant) return "";
  const w = wallClock(instant, timeZone);
  if (!w) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${w.y}-${p(w.m)}-${p(w.d)} ${p(Math.floor(w.minutes / 60))}:${p(w.minutes % 60)}`;
}

function weekdayName(value) {
  const iso = isoDay(value);
  if (!iso) return "";
  const at = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? "" : WEEKDAYS[at.getUTCDay()];
}

const yesNo = (v) => (v === true ? "Yes" : v === false ? "No" : "");

/** Days sheet — one row per reconciled day. Keys are the payroll contract. */
const DAY_COLUMNS = [
  { header: "Employee", key: "employee", width: 26 },
  { header: "Department", key: "department", width: 18 },
  { header: "Entity", key: "entity", width: 22 },
  { header: "Work date", key: "work_date", width: 12 },
  { header: "Weekday", key: "weekday", width: 11 },
  { header: "Expected", key: "expected", width: 10 },
  { header: "Status", key: "status", width: 11 },
  { header: "Expected start", key: "expected_start", width: 13 },
  { header: "First in", key: "first_in", width: 18 },
  { header: "Last out", key: "last_out", width: 18 },
  { header: "Hours", key: "hours", width: 9 },
  { header: "Minutes late", key: "minutes_late", width: 13 },
  { header: "On site", key: "on_site", width: 10 },
  { header: "Location", key: "geo_label", width: 26 },
  { header: "Device", key: "device_label", width: 20 },
  { header: "Device trusted", key: "device_trusted", width: 14 },
  { header: "Deduction", key: "deduction", width: 13 },
  { header: "Waived", key: "waived", width: 9 },
  { header: "Justification", key: "justification", width: 30 },
  { header: "Leave type", key: "leave_type", width: 14 },
  { header: "Rule", key: "rule_code", width: 12 },
];

/** Punches sheet — one row per punch, including days never reconciled. */
const PUNCH_COLUMNS = [
  { header: "Employee", key: "employee", width: 26 },
  { header: "Clock in", key: "clock_in", width: 18 },
  { header: "Clock out", key: "clock_out", width: 18 },
  { header: "Latitude", key: "lat", width: 12 },
  { header: "Longitude", key: "lng", width: 12 },
  { header: "Within geofence", key: "within_geofence", width: 15 },
  { header: "Location", key: "geo_label", width: 26 },
  { header: "Distance (m)", key: "distance_m", width: 13 },
  { header: "Device", key: "device", width: 20 },
  { header: "Late", key: "late", width: 8 },
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

function dayRow(d, timeZone) {
  const hours = hoursBetween(d.first_clock_in_at, d.last_clock_out_at);
  return {
    employee: d.employee_name || "",
    department: d.department || "",
    entity: d.entity_name || "",
    work_date: isoDay(d.work_date),
    weekday: weekdayName(d.work_date),
    expected: EXPECTED.has(String(d.status || "").toUpperCase()) ? "Yes" : "No",
    status: d.status || "",
    expected_start: d.expected_start_time || "",
    first_in: localStamp(d.first_clock_in_at, timeZone),
    last_out: localStamp(d.last_clock_out_at, timeZone),
    hours: hours === null ? "" : round2(hours),
    minutes_late: Number(d.minutes_late) || 0,
    on_site: dayOnSite(d),
    geo_label: d.geo_label || "",
    device_label: d.device_label || "",
    device_trusted: yesNo(d.device_trusted),
    deduction: Number(d.deduction_amount) || 0,
    waived: yesNo(!!d.justified),
    justification: d.justification || "",
    leave_type: d.leave_type || "",
    rule_code: d.rule_code || "",
  };
}

function punchRow(p, timeZone) {
  return {
    employee: p.employee_name || "",
    clock_in: localStamp(p.clock_in_at, timeZone),
    clock_out: localStamp(p.clock_out_at, timeZone),
    lat: p.latitude === null || p.latitude === undefined ? "" : Number(p.latitude),
    lng: p.longitude === null || p.longitude === undefined ? "" : Number(p.longitude),
    within_geofence: yesNo(p.within_geofence),
    geo_label: p.geo_label || "",
    distance_m: p.distance_m === null || p.distance_m === undefined ? "" : Number(p.distance_m),
    device: p.device_label || "",
    late: yesNo(p.is_late),
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
 * @param {string} input.timeZone  workplace zone; stamps are written in it
 * @param {string} input.format    "xlsx" | "csv"
 * @param {string} input.sheet     CSV only: "days" (default) | "punches"
 */
async function build({ days = [], punches = [], from, to, timeZone = "UTC", format = "xlsx", sheet = "days" } = {}) {
  const dayRows = days.map((d) => dayRow(d, timeZone));
  const punchRows = punches.map((p) => punchRow(p, timeZone));
  const truncated = days.length >= repo.MAX_REPORT_ROWS || punches.length >= repo.MAX_REPORT_ROWS;

  if (format === "csv") {
    // CSV is one table by definition, so the caller picks which one.
    const punchesWanted = String(sheet).toLowerCase() === "punches";
    return {
      buffer: buildCsv({
        columns: punchesWanted ? PUNCH_COLUMNS : DAY_COLUMNS,
        rows: punchesWanted ? punchRows : dayRows,
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
    }),
    filename: filename(from, to, "xlsx"),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    truncated,
  };
}

module.exports = { build, DAY_COLUMNS, PUNCH_COLUMNS, dayRow, punchRow, filename };
