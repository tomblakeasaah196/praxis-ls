/**
 * The tenant's milestone-owner registry, for every screen that renders one.
 *
 * ── WHY A HOOK AND NOT A CONSTANT ───────────────────────────────────────────
 *
 * Owners used to be five strings in `OWNER_TIER_LABEL`, so six screens imported
 * that map and indexed it. Meeting 7 (1 Oct 2026), 01:57:20 made the list a
 * tenant registry (`milestone_owner`, 14400), which means the labels are DATA and
 * a screen has to fetch them. One hook rather than six fetches: `useResource` is a
 * TanStack Query shim, so every caller in a render shares one request and one
 * cache entry.
 *
 * ── IT NEVER RENDERS A SCREAMING_CODE ───────────────────────────────────────
 *
 * `label()` works before the fetch resolves, and works for a code whose row a
 * tenant has since deleted — falling back to the shipped label map and then to
 * the code. An owner column that reads "AUTHORITY" for half a second, or forever
 * on a closed file, is the regression this guards against (FRONTEND_GUIDE §5).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useResource } from "./use-resource";
import * as api from "./operations-api";

export type { MilestoneOwner } from "./operations-api";

/**
 * The owner registry, with a label function bound to the reader's language.
 *
 * ── IT FETCHES EVERY ROW, THE DEACTIVATED ONES INCLUDED ────────────────────
 *
 * The obvious call is the active-only one, and it is wrong here. A stage can hold
 * an owner a tenant has switched off, and so can a closed milestone's
 * `attributed_to`; with only the active rows in hand this hook has no NAME for
 * those codes and falls through to rendering `ROAD_AUTHORITY` — the screaming
 * enum the frontend rules exist to prevent (FRONTEND_GUIDE §5). One fetch of the
 * whole registry gives every code a tenant has ever defined a label, and
 * `options` does the filtering instead.
 */
export function useMilestoneOwners(currentCode?: string | null) {
  const { i18n } = useTranslation();
  const lang = i18n?.language || "en";
  const res = useResource(() => api.listAllMilestoneOwners(), []);
  // Memoised, not `res.data || []`: a fresh [] on every render would change the
  // identity of every dependency below and re-make `label` and `options` each
  // time, which re-renders every row that holds one.
  const owners = React.useMemo(() => res.data || [], [res.data]);

  const label = React.useCallback(
    (code?: string | null) => api.ownerLabelFrom(owners, code, lang),
    [owners, lang],
  );

  /** What a picker offers: the ACTIVE rows, in the registry's running order. */
  const base = React.useMemo(
    () =>
      owners
        .filter((o) => o.is_active !== false)
        .map((o) => ({ code: o.code, label: api.ownerLabelFrom(owners, o.code, lang) })),
    [owners, lang],
  );

  /**
   * The options for a dropdown whose current value is `code`.
   *
   * A stage can hold an owner a tenant has since DEACTIVATED or deleted. Dropping
   * it from its own dropdown would mean editing one field of a stage silently
   * reassigns another — so it is appended, and marked, because "this party is no
   * longer offered" is something the person re-saving the stage should know
   * rather than discover. One helper, because the chain editor, the ad-hoc insert
   * dialog and anything added later must behave the same way.
   */
  const optionsWith = React.useCallback(
    (code?: string | null) => {
      if (!code || base.some((o) => o.code === code)) return base;
      return [...base, { code, label: `${api.ownerLabelFrom(owners, code, lang)} (retired)` }];
    },
    [base, owners, lang],
  );

  /** Convenience for a picker with no current value, or one bound at call time. */
  const options = React.useMemo(() => optionsWith(currentCode), [optionsWith, currentCode]);

  return { owners, options, optionsWith, label, loading: res.loading, error: res.error, reload: res.reload };
}

/** True when this code is one of ours — the attribution split's only question. */
export const isInternalOwner = (
  owners: api.MilestoneOwner[] | null | undefined,
  code?: string | null,
): boolean => !!(owners || []).find((o) => o.code === code)?.is_internal;
