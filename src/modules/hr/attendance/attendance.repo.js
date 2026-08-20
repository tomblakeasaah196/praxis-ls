/**
 * Attendance repository (MOD-14). Factory base + a bespoke joined/filtered list
 * (employee name, filter by employee, open shifts, or date).
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { updateOne } = require("../../../shared/db/query-helpers");
const { page } = require("../../../shared/db/query-helpers");

const base = makeRepo({ table: "attendance_log", pk: "attendance_id", activeColumn: null, searchColumn: null, orderBy: "created_at DESC",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at"],
});

/**
 * At most this many employees in one `employee_ids` filter.
 *
 * The validator enforces the same number (§5 PR2: "cap 50"). It is repeated
 * here deliberately: the repo is reachable from the reconciler and from jobs
 * that never pass through a request validator, and an unbounded `= ANY($1)`
 * against a 366-day window is the shape of query that takes a tenant's
 * database down at month end.
 */
const MAX_EMPLOYEE_IDS = 50;

/** Hard ceiling on a report read. An export is a report, not a page (§6.7). */
const MAX_REPORT_ROWS = 20000;

const rowCap = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_REPORT_ROWS) : MAX_REPORT_ROWS;
};

/** Clean, de-duplicate and cap a list of employee ids. */
function employeeIdList(value) {
  if (!Array.isArray(value)) return [];
  const seen = [...new Set(value.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()))];
  return seen.slice(0, MAX_EMPLOYEE_IDS);
}

/**
 * The punch window — the ONE place this predicate lives.
 *
 * Shared by the paged `list` and the capped `punchesInRange` so a fix to the
 * timezone maths lands on both. Pushes onto `params` and returns WHERE
 * fragments; the caller decides the SELECT, the order and the limit.
 *
 * Local-zone bounds, never `clock_in_at::date`: that is the UTC date, so a
 * 00:30 Douala punch lands on the previous day and disappears from Today.
 */
function punchWhere(q, params) {
  const wh = [];
  if (q.employee_id) { params.push(q.employee_id); wh.push("al.employee_id = $" + params.length); }
  const ids = employeeIdList(q.employee_ids);
  if (ids.length) { params.push(ids); wh.push("al.employee_id = ANY($" + params.length + "::uuid[])"); }
  if (q.department) { params.push(q.department); wh.push("e.department = $" + params.length); }
  if (q.open === "true" || q.open === true) wh.push("al.clock_out_at IS NULL");

  const tz = typeof q.timeZone === "string" && q.timeZone.trim() ? q.timeZone.trim() : "Africa/Douala";
  if (q.date) {
    params.push(q.date, tz);
    wh.push("al.clock_in_at >= ($" + (params.length - 1) + "::timestamp AT TIME ZONE $" + params.length + ")");
    wh.push("al.clock_in_at <  (($" + (params.length - 1) + "::date + 1)::timestamp AT TIME ZONE $" + params.length + ")");
  } else if (q.from || q.to) {
    if (q.from) {
      params.push(q.from, tz);
      wh.push("al.clock_in_at >= ($" + (params.length - 1) + "::timestamp AT TIME ZONE $" + params.length + ")");
    }
    if (q.to) {
      params.push(q.to, tz);
      wh.push("al.clock_in_at <  (($" + (params.length - 1) + "::date + 1)::timestamp AT TIME ZONE $" + params.length + ")");
    }
  }
  return wh;
}

module.exports = {
  ...base,
  MAX_EMPLOYEE_IDS,
  MAX_REPORT_ROWS,
  employeeIdList,

  // ── Self-service resolution ──
  async employeeIdForUser(client, userId) {
    const { rows } = await client.query("SELECT employee_id FROM app_user WHERE user_id = $1", [userId]);
    return rows[0] ? rows[0].employee_id : null;
  },
  async entityForEmployee(client, employeeId) {
    const { rows } = await client.query("SELECT entity_id FROM employee WHERE employee_id = $1", [employeeId]);
    return rows[0] ? rows[0].entity_id : null;
  },
  async openForEmployee(client, employeeId) {
    const { rows } = await client.query(
      "SELECT * FROM attendance_log WHERE employee_id = $1 AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1",
      [employeeId],
    );
    return rows[0] || null;
  },

  // ── Worksites (geofence centres) ──
  activeSitesForEntity(client, entityId) {
    return client
      .query(
        "SELECT * FROM work_site WHERE is_active = true AND (entity_id = $1 OR entity_id IS NULL) ORDER BY name",
        [entityId],
      )
      .then((r) => r.rows);
  },
  listSites(client) {
    return client.query("SELECT * FROM work_site ORDER BY is_active DESC, name").then((r) => r.rows);
  },
  getSite(client, id) {
    return client.query("SELECT * FROM work_site WHERE work_site_id = $1", [id]).then((r) => r.rows[0] || null);
  },
  insertSite(client, data) {
    const { entity_id = null, name, latitude, longitude, radius_m = 150, is_active = true } = data;
    return client
      .query(
        "INSERT INTO work_site (entity_id, name, latitude, longitude, radius_m, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
        [entity_id, name, latitude, longitude, radius_m, is_active],
      )
      .then((r) => r.rows[0]);
  },
  async updateSite(client, id, fields) {
    // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
    // identifier validation and writable allow-list in query-helpers.
    if (!Object.keys(fields).length) return this.getSite(client, id);
    return updateOne(client, "work_site", "work_site_id", id, fields, "*", null, { touch: "updated_at" });
  },

  // ── Registered devices (0524) ──
  /**
   * See a device: create it PENDING, or bump `last_seen_at` on the row that is
   * already there. Returns the row either way.
   *
   * ON CONFLICT rather than SELECT-then-INSERT because two punches racing from
   * the same freshly-installed device would otherwise both miss the select and
   * both insert, and the unique index would fail the second — a punch lost to a
   * constraint violation the user cannot act on.
   *
   * `(xmax = 0) AS inserted` distinguishes the INSERT from the UPDATE — an
   * upsert otherwise returns the same row either way, and the caller cannot tell
   * a device it has just met from one it sees every morning. It is the signal
   * that lets the clock ask "name this device?" exactly once, on the punch that
   * created it, instead of nagging on every punch forever.
   *
   * The status is DELIBERATELY NOT in the update list. A revoked device that
   * reappears must stay revoked; letting the upsert reset it to PENDING would
   * make revocation decay back into "nobody has looked yet" every time the
   * device was used again, which is the opposite of what revoking means. The
   * label is only refreshed while it is still the auto-seeded one, so an
   * employee's rename survives them opening the app on a new browser version.
   */
  upsertDevice(client, { employeeId, fingerprint, label, userAgent = null, platform = null }) {
    return client
      .query(
        `INSERT INTO hr_device (employee_id, fingerprint, label, user_agent, platform)
              VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (employee_id, fingerprint) DO UPDATE
            SET last_seen_at = now(),
                updated_at   = now(),
                user_agent   = COALESCE(EXCLUDED.user_agent, hr_device.user_agent),
                platform     = COALESCE(EXCLUDED.platform, hr_device.platform)
          RETURNING *, (xmax = 0) AS inserted`,
        [employeeId, fingerprint, label, userAgent, platform],
      )
      .then((r) => r.rows[0]);
  },
  listDevices(client, { employeeId = null } = {}) {
    const params = [];
    let where = "";
    if (employeeId) { params.push(employeeId); where = "WHERE d.employee_id = $1"; }
    return client
      .query(
        `SELECT d.*, e.full_name AS employee_name
           FROM hr_device d
           LEFT JOIN employee e ON e.employee_id = d.employee_id
           ${where}
          ORDER BY (d.status = 'PENDING') DESC, d.last_seen_at DESC`,
        params,
      )
      .then((r) => r.rows);
  },
  getDevice(client, id) {
    return client.query("SELECT * FROM hr_device WHERE hr_device_id = $1", [id]).then((r) => r.rows[0] || null);
  },
  updateDevice(client, id, fields) {
    if (!Object.keys(fields).length) return this.getDevice(client, id);
    return updateOne(client, "hr_device", "hr_device_id", id, fields, "*", null, { touch: "updated_at" });
  },

  async list(client, q = {}) {
    const { limit, offset } = page(q);
    const params = [limit, offset];
    const wh = punchWhere(q, params);
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    const { rows } = await client.query(
      `SELECT al.*, e.full_name AS employee_name, e.department,
              dv.label AS device_label, dv.status AS device_status
         FROM attendance_log al
         LEFT JOIN employee e ON e.employee_id = al.employee_id
         LEFT JOIN hr_device dv ON dv.hr_device_id = al.hr_device_id
         ${where}
        ORDER BY al.clock_in_at DESC NULLS LAST
        LIMIT $1 OFFSET $2`,
      params,
    );
    return rows;
  },

  /**
   * Punches for a report — the same window as `list`, without its page.
   *
   * `page()` clamps every list to 200 rows, which is the right answer for a
   * screen and the wrong one for a 366-day export: the file would silently be
   * a prefix of the truth, which is worse than refusing. So this is a separate
   * read with its own hard cap, and it shares `punchWhere` with `list` so the
   * two can never disagree about which local day a punch fell on — the drift
   * 10740/PR1 existed to remove.
   */
  async punchesInRange(client, q = {}) {
    const params = [];
    const wh = punchWhere(q, params);
    const where = wh.length ? "WHERE " + wh.join(" AND ") : "";
    params.push(rowCap(q.cap));
    const { rows } = await client.query(
      `SELECT al.*, e.full_name AS employee_name, e.department,
              dv.label AS device_label, dv.status AS device_status
         FROM attendance_log al
         LEFT JOIN employee e ON e.employee_id = al.employee_id
         LEFT JOIN hr_device dv ON dv.hr_device_id = al.hr_device_id
         ${where}
        ORDER BY al.clock_in_at ASC NULLS LAST
        LIMIT $${params.length}`,
      params,
    );
    return rows;
  },
};
