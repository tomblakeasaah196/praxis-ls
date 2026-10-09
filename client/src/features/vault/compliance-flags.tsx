/**
 * Vault — compliance flags raised against dossiers and documents.
 *
 * Split out of `features/vault/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import {
  errMsg,
  useList,
  useListPaged,
  useRefresh,
  type Row,
} from "@/lib/use-resource";
import { Pagination } from "@/components/ui/pagination";
import { cell, smartCell } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";
import { Segmented } from "@/components/ui/segmented";

const COMPLIANCE_AI: AiAction[] = [
  {
    label: "Triage Open Flags",
    kind: "assist",
    describe:
      "Summarise open compliance flags by severity and suggest what to fix first.",
  },
];

const SEVERITY_FILTERS = [
  { value: "", label: "All" },
  { value: "RED", label: "Red" },
  { value: "WARN", label: "Warning" },
  { value: "INFO", label: "Info" },
  { value: "ESCALATED", label: "Escalated" },
  { value: "SOFT_BLOCK_RECOMMENDATION", label: "Soft Block" },
  { value: "HARD_BLOCK", label: "Hard Block" },
];
const PAGE_SIZE = 25;

export function ComplianceFlagsPage() {
  const [tab, setTab] = React.useState<"flags" | "rules">("flags");
  const reload = useRefresh();
  const [severity, setSeverity] = React.useState("");
  const [includeResolved, setIncludeResolved] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [running, setRunning] = React.useState(false);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Filters are applied by the server before the page limit, so older flags do
  // not disappear behind the first page. The catalogue remains an ordinary
  // list because it is small and never changes with the flag filters.
  React.useEffect(() => {
    setPage(0);
  }, [severity, includeResolved]);
  const {
    rows: flags,
    error: flagsError,
    total: flagsTotal,
  } = useListPaged<Row>("/compliance", {
    page,
    pageSize: PAGE_SIZE,
    severity: severity || undefined,
    include_resolved: includeResolved ? "true" : undefined,
  });
  React.useEffect(() => {
    // Resolving the last flag on the last page should land on the page before it.
    if (flags?.length === 0 && page > 0) setPage(page - 1);
  }, [flags, page]);
  const { rows: rules, error: rulesError } = useList<Row>(
    "/compliance/catalogue",
  );

  const error = actionError ?? flagsError ?? rulesError;
  const setError = setActionError;

  async function runChecks() {
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const res = await tenant<Row>("/compliance/run", {
        method: "POST",
        body: {},
      });
      const s =
        (res && typeof res === "object" ? (res as Row).summary : null) ?? res;
      setSummary(typeof s === "string" ? s : smartCell(s));
      reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRunning(false);
    }
  }
  async function resolve(id: string) {
    setRowBusy(id);
    try {
      await tenant(`/compliance/${id}/resolve`, { method: "POST", body: {} });
      reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Vault & Compliance" to="/vault" />}
        title="Compliance Flags"
        description="Run the rule scans and clear the flags they raise."
        action={
          <div className="flex items-center gap-3">
            <Segmented
              label="Compliance section"
              value={tab}
              onChange={setTab}
              options={[
                { value: "flags", label: "Flags" },
                { value: "rules", label: "Rules" },
              ]}
            />
            {tab === "flags" && (
              <Button onClick={runChecks} loading={running}>
                Run checks
              </Button>
            )}
          </div>
        }
      />
      <HubTabs />

      {summary && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
          Last run: {summary}
        </div>
      )}
      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      {tab === "flags" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Chips
              label="Filter flags by severity"
              value={severity}
              options={SEVERITY_FILTERS}
              onChange={setSeverity}
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={includeResolved}
                onChange={(e) => setIncludeResolved(e.target.checked)}
              />
              Include resolved
            </label>
          </div>
          {flags === null ? (
            <SkeletonTable />
          ) : flags.length === 0 ? (
            <EmptyState
              title={
                flagsTotal > 0
                  ? "No flags on this page"
                  : severity
                    ? "No flags match"
                    : includeResolved
                      ? "No flags to show"
                      : "No open flags"
              }
              hint={
                severity
                  ? "Try another severity."
                  : "Run the checks to scan for compliance issues."
              }
            />
          ) : (
            <>
              <div className="space-y-2">
                {flags.map((f) => {
                  const id = String(f.compliance_flag_id ?? f.flag_id);
                  const resolved = f.resolved_at || f.is_resolved;
                  return (
                    <div
                      key={id}
                      className="lux-card flex items-center gap-3 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {cell(f.rule_key)}
                          </p>
                          <StatusPill status={String(f.severity || "—")} />
                          {resolved ? (
                            <span className="text-xs text-muted-foreground">
                              resolved
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {cell(f.message)} · {cell(f.entity_ref)}
                        </p>
                      </div>
                      {!resolved && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={rowBusy === id}
                          onClick={() => resolve(id)}
                        >
                          Resolve
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={flagsTotal}
                onPageChange={setPage}
                className="flex-col items-start sm:flex-row sm:items-center"
              />
            </>
          )}
        </>
      ) : rules === null ? (
        <SkeletonTable />
      ) : (
        <div className="space-y-2">
          {(rules || []).map((r) => (
            <div
              key={String(r.rule_key)}
              className="lux-card flex items-center gap-3 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {cell(r.rule_key)}
                  </p>
                  <StatusPill status={String(r.severity || "—")} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {cell(r.describe)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <AiActions actions={COMPLIANCE_AI} />
    </section>
  );
}

/* ═══════════════════════════════════ DOCUMENTS ═══════════════════════════════════ */
