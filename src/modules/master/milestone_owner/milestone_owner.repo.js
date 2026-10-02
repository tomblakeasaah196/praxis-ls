/**
 * Milestone-owner registry (MOD-31) — the parties a milestone stage waits on,
 * and whom a slip is charged to. Shared registry kit.
 *
 * Meeting 7 (1 Oct 2026), 01:57:20: "we're going to have a settings button, a
 * configurations button that will permit us to create new milestone owner
 * categories". Before this the five values were a zod enum and two DB CHECKs
 * (dropped in 14400), so a forwarder whose permits sit with the road authority
 * and whose survey sits with a marine surveyor filed both under "Authority".
 *
 * `code` IS NOT IN THE WRITABLE LIST ON PURPOSE — mass assignment is closed by
 * that list (a request cannot set `is_system` and mint a shipped row), and `code`
 * is additionally excluded from UPDATE by `updatable` below: every stage and
 * every closed instance stores it, and the attribution report groups on it, so
 * renaming it orphans history. The name is what a person reads and is free.
 */
"use strict";
const { build } = require("../_shared/registry");

/** Set on create; never rewritten afterwards. */
const IMMUTABLE_ON_UPDATE = ["code"];

const kit = build({
  table: "milestone_owner",
  pk: "owner_id",
  moduleKey: "MOD-31",
  label: "milestone_owner",
  // The dropdown's running order, not alphabetical: "Internal ops" leads and
  // "Other party" trails, which is how the list reads when you are picking.
  orderBy: "sort_order, code",
  writable: [
    "code", "name", "name_fr",
    // The one flag that carries behaviour: the delay-attribution split ("ours
    // or theirs") reads this and nothing else, so a tenant's own internal desk
    // still counts as ours.
    "is_internal",
    "description", "sort_order", "is_active",
  ],
});

/**
 * `code` is writable on INSERT and frozen on UPDATE.
 *
 * The kit has ONE allow-list, which closes mass assignment but cannot express
 * "settable once", so the narrowing lives here. Stripped rather than rejected: a
 * PATCH that echoes the whole row back — which is what a form does — should save
 * the names, not 422 because it also sent the code it did not change.
 */
const baseUpdate = kit.repo.update;
kit.repo.update = (c, id, fields) => {
  const patch = { ...fields };
  for (const k of IMMUTABLE_ON_UPDATE) delete patch[k];
  return baseUpdate(c, id, patch);
};

/** The active owners, in display order — what every picker loads. */
kit.repo.active = async (c) => {
  const { rows } = await c.query(
    "SELECT owner_id, code, name, name_fr, is_internal, description, sort_order, is_system, is_active" +
      " FROM milestone_owner WHERE is_active ORDER BY sort_order, code",
  );
  return rows;
};

/**
 * Which of `codes` are not a known ACTIVE owner. The referential check that an
 * FK would have done — 14400's header says why there is no FK (the 13791 rule),
 * so this is the enforcement and `milestone.service` is its one caller.
 */
kit.repo.unknownCodes = async (c, codes) => {
  const wanted = [...new Set((codes || []).filter(Boolean).map(String))];
  if (!wanted.length) return [];
  const { rows } = await c.query(
    "SELECT code FROM milestone_owner WHERE is_active AND code = ANY($1::text[])",
    [wanted],
  );
  const known = new Set(rows.map((r) => r.code));
  return wanted.filter((cd) => !known.has(cd));
};

module.exports = kit;
