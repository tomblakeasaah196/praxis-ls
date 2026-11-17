"use strict";

const { listComplete } = require("../../../shared/db/query-helpers");
const { makeRepo } = require("../../../shared/crud/resource");

const base = makeRepo({
  // SEC H3. The grant matrix. PUT /permissions/grant is validated properly now
  // (permission.validator), but the generic CRUD create/update on the same
  // table still went through passthrough — a second door to the same rows.
  writable: ["role_id", "module_key", "can_create", "can_read", "can_update", "can_delete", "can_approve",
    // 12771 — export is a right over data; validate and disburse are the two
    // decisions maker-checker most wants apart from "approve".
    "can_export", "can_validate", "can_disburse",
    // Calls audit PR-7 (O5): runs checks that spend provider credit.
    "can_test"],
  table: "permission",
  pk: "permission_id",
  activeColumn: null,
  searchColumn: null,
  // The permission table has no created_at/updated_at — order by its real
  // columns (was "created_at DESC", which 500'd GET /permissions).
  orderBy: "role_id, module_key",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at"],
  // API F-28: this repo uses makeRepo's list unchanged, which honours only
  // limit/offset/q — any other key was silently ignored. Now it is named.
  filterable: [],
});

/**
 * EVERY grant, unpaginated — what the matrix editor needs.
 *
 * The generic `list()` clamps to 50 rows (shared/db/query-helpers.js page()),
 * and the matrix was loading through it. With 11 roles × 72 modules the default
 * seed alone writes far more than 50 `permission` rows, so the editor only ever
 * saw the first page. That is not a display bug — it is destructive:
 *
 *   · a cell whose grant exists but wasn't in the first 50 renders EMPTY;
 *   · clicking one permission on that cell computes `current` as an all-false
 *     grant and PUTs the whole row, and the upsert overwrites all five columns
 *     from EXCLUDED — so the grants that were already there are wiped;
 *   · after a refresh the row still isn't in the first page, so the cell looks
 *     empty again and the edit looks like it "didn't save".
 *
 * Bounded by roles × modules and admin-only, so returning the lot is safe. The
 * paginated `list()` stays for any other caller.
 */
async function listAll(client) {
  const { rows } = await listComplete(client, "SELECT * FROM permission ORDER BY role_id, module_key", [], { label: "The permission grant matrix", ceiling: 20000 });
  return rows;
}


/**
 * The module keys the CALLER can see, for the navigation shell.
 *
 * SELF-SCOPED, AND THAT IS THE WHOLE POINT. Every other read in this module is
 * MOD-67 (IAM) gated, because seeing the grant matrix means seeing what everyone
 * else can do. This one answers only "what can I see", which the caller already
 * learns by clicking around — so gating it on IAM would mean nobody but an
 * administrator could render a navigation menu.
 *
 * `can_read` alone, deliberately: the shell decides whether to SHOW a
 * destination, not whether a write will be allowed. A user with create-but-not-
 * read on a module has a broken grant, and hiding it is the right reading.
 *
 * Returns bare keys rather than the full row. The matrix is roles × 76 modules
 * × 5 flags; the shell needs a set of strings, and sending the rest would ship
 * the tenant's whole authorisation model to the browser to render a menu.
 */
async function visibleModuleKeys(client, roleIds) {
  if (!roleIds || roleIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT DISTINCT module_key
       FROM permission
      WHERE role_id = ANY($1::uuid[]) AND can_read
      ORDER BY module_key`,
    [roleIds],
  );
  return rows.map((r) => r.module_key);
}

/**
 * What each module lets these roles DO, beyond reading it.
 *
 * `visibleModuleKeys` answers "which screens may this person open". This
 * answers the next question a screen has: "which of my buttons will the server
 * accept". The action names are `requirePermission`'s own (rbac.js `ACTION_COLUMN`),
 * so the client asks in the words the routes are guarded in: `edit`, never
 * `update`.
 *
 * `bool_or` across the caller's roles is the same disjunction rbac.js applies
 * (`grants.some((g) => g[column] === true)`): any one role holding the action is
 * enough. No `can_read` filter, for the same reason: the enforcement path does
 * not look at `can_read` when it checks `create`, so neither does this.
 *
 * `read` is not an action here. It is `visibleModuleKeys`, and saying it twice
 * would be two answers that can disagree.
 */
const WRITE_ACTIONS = {
  create: "can_create",
  edit: "can_update",
  delete: "can_delete",
  approve: "can_approve",
  export: "can_export",
  validate: "can_validate",
  disburse: "can_disburse",
  test: "can_test",
};

async function grantedActions(client, roleIds) {
  if (!roleIds || roleIds.length === 0) return {};
  const cols = Object.entries(WRITE_ACTIONS)
    .map(([action, col]) => `bool_or(${col}) AS "${action}"`)
    .join(", ");
  const { rows } = await client.query(
    `SELECT module_key, ${cols}
       FROM permission
      WHERE role_id = ANY($1::uuid[])
      GROUP BY module_key
      ORDER BY module_key`,
    [roleIds],
  );
  const out = {};
  for (const r of rows) {
    const held = Object.keys(WRITE_ACTIONS).filter((action) => r[action] === true);
    if (held.length) out[String(r.module_key).toUpperCase()] = held;
  }
  return out;
}

/**
 * Upsert a grant by its natural key (role_id, module_key) — the grant-matrix
 * edits by role×module, not by permission_id. Relies on the table's
 * UNIQUE(role_id, module_key). Returns the resulting row.
 *
 * AN ABSENT FLAG IS LEFT ALONE, NOT REVOKED (12771). It used to write every
 * column from EXCLUDED, so a caller that did not send `can_export` set it to
 * false — and since 12771 backfilled the three new flags from what gated them
 * before, the first edit of any cell from a client that predates them would
 * have quietly revoked export, validate and disburse across that whole row.
 * `undefined` now means "unchanged" and the flags are coalesced against the
 * stored row. A client that means to revoke sends `false`, which is a value.
 */
async function upsertGrant(client, g) {
  const flag = (v) => (v === undefined || v === null ? null : !!v);
  const { rows } = await client.query(
    `INSERT INTO permission (role_id, module_key,
       can_create, can_read, can_update, can_delete, can_approve,
       can_export, can_validate, can_disburse, can_test)
     VALUES ($1,$2,
       COALESCE($3,false), COALESCE($4,false), COALESCE($5,false), COALESCE($6,false), COALESCE($7,false),
       COALESCE($8,false), COALESCE($9,false), COALESCE($10,false), COALESCE($11,false))
     ON CONFLICT (role_id, module_key) DO UPDATE SET
       can_create   = COALESCE($3,  permission.can_create),
       can_read     = COALESCE($4,  permission.can_read),
       can_update   = COALESCE($5,  permission.can_update),
       can_delete   = COALESCE($6,  permission.can_delete),
       can_approve  = COALESCE($7,  permission.can_approve),
       can_export   = COALESCE($8,  permission.can_export),
       can_validate = COALESCE($9,  permission.can_validate),
       can_disburse = COALESCE($10, permission.can_disburse),
       can_test     = COALESCE($11, permission.can_test)
     RETURNING *`,
    [g.role_id, g.module_key,
      flag(g.can_create), flag(g.can_read), flag(g.can_update), flag(g.can_delete), flag(g.can_approve),
      flag(g.can_export), flag(g.can_validate), flag(g.can_disburse), flag(g.can_test)],
  );
  return rows[0];
}

module.exports = { ...base, listAll, upsertGrant, visibleModuleKeys, grantedActions, WRITE_ACTIONS };
