/**
 * Sales & CRM › Leads: one row per company (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md
 * §3.2, owner decisions D2, D3, D4).
 *
 * Desktop first (D1): a split pane, the list on the left and the company's 360
 * on the right; on a phone the record opens in a sheet over the list. A
 * List | Board toggle swaps the list for the board of requests (desktop only).
 *
 * THE LIST IS PAGED AND FILTERED ON THE SERVER (gap 10). A chip (My Next Steps
 * by default), a tile (Due Today, Overdue, Open Value, each also a filter) and
 * a search (company, contact, email, phone, or a request's reference) go to
 * `GET /leads`, which answers one page, its total and the three tiles over the
 * same set, so a tile never disagrees with the rows under it.
 */
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { pageShell } from "@/lib/layout";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { useResource } from "@/lib/use-resource";
import { money, moneyCompact, num } from "@/lib/format";
import { useCan } from "@/lib/route-access";
import { isDesktopNow, useIsDesktop } from "@/lib/use-media-query";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chips } from "@/components/ui/chips";
import { Segmented } from "@/components/ui/segmented";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { SplitPane } from "@/components/ui/split-pane";
import { IndexRow } from "@/components/ui/index-row";
import { Avatar } from "@/components/ui/avatar";
import { Pill } from "@/components/ui/pill";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { listLeads, VIEW_LABEL, type LeadListQuery, type LeadRow, type LeadView } from "@/lib/lead-api";
import { lead as leadShape } from "@shared";
import { CaptureLeadDialog } from "./lead-capture";
import { DueDate, LeadRecordView } from "./lead-360";
import { LeadsBoard } from "./leads-board";

const LEADS_AI: AiAction[] = [
  { label: "Suggest next action", kind: "assist", describe: "Suggest the next best step for a company that has gone quiet, from its history." },
  { label: "Draft outreach", kind: "write", describe: "Draft a first-contact email for a new company (human-confirmed before send)." },
];

const PAGE = 50;
const VIEWS = leadShape.VIEWS as readonly LeadView[];
const VIEW_OPTIONS = VIEWS.map((v) => ({ value: v, label: tr(VIEW_LABEL[v]) }));
type Mode = "list" | "board";

/** Search as you type, sent once the typing pauses. */
function useDebounced(value: string, ms = 300) {
  const [out, setOut] = React.useState(value);
  React.useEffect(() => {
    const h = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(h);
  }, [value, ms]);
  return out;
}

function LeadIndexRow({ r, selected, onOpen, moneyVisible }: { r: LeadRow; selected: boolean; onOpen: () => void; moneyVisible: boolean }) {
  const value = moneyVisible && Number(r.open_value || 0) > 0 ? moneyCompact(Number(r.open_value), r.open_currency || "XAF") : null;
  return (
    <IndexRow selected={selected} onClick={onOpen} className="items-center gap-2">
      <Avatar name={r.company_name || "?"} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{r.company_name}</span>
          <Pill tone={r.is_client ? "ok" : "blue"} className="shrink-0">
            {r.is_client ? tr("Client") : tr("Prospect")}
          </Pill>
        </span>
        <span className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
          {r.status === "ARCHIVED" ? (
            <span>{tr("Archived")}</span>
          ) : r.next_step_due_at ? (
            <span className="min-w-0 truncate">
              <DueDate at={r.next_step_due_at} /> {r.next_step_action ? `· ${r.next_step_action}` : ""}
            </span>
          ) : (
            <span>{tr("No next step")}</span>
          )}
          {value ? <span className="num shrink-0">{value}</span> : null}
        </span>
      </span>
    </IndexRow>
  );
}

export function LeadsPage() {
  const can = useCan("MOD-20");
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get("view") === "board" && isDesktop ? "board" : "list";
  const [view, setView] = React.useState<LeadView>("mine");
  const [due, setDue] = React.useState<"" | "today" | "overdue">("");
  const [hasValue, setHasValue] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [capture, setCapture] = React.useState(false);
  const q = useDebounced(search);

  // A new filter starts at the first page.
  React.useEffect(() => setPage(0), [view, due, hasValue, q]);

  const query: LeadListQuery = { view, due, has_value: hasValue, q, limit: PAGE, offset: page * PAGE };
  const res = useResource(() => listLeads(query), [view, due, hasValue, q, page]);
  const rows = res.data?.rows ?? null;
  const tiles = res.data?.tiles ?? null;
  const moneyVisible = Boolean(tiles?.money_visible);

  // Open the first company once the list arrives, on a desktop, so the right
  // pane is never an empty frame. On a phone the record is a sheet, and opening
  // one unasked would cover the list.
  React.useEffect(() => {
    if (!selId && rows && rows.length && isDesktopNow()) setSelId(rows[0].lead_id);
  }, [rows, selId]);

  const setMode = (m: Mode) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (m === "board") p.set("view", "board");
        else p.delete("view");
        return p;
      },
      { replace: true },
    );

  const selected = rows?.find((r) => r.lead_id === selId) || null;
  const filtered = view !== "mine" || !!due || hasValue || !!q;

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title={tr("Leads")}
        description={tr("One row per company. Every open company has a dated next step.")}
        action={can("create") && <Button onClick={() => setCapture(true)}>{tr("Capture Lead")}</Button>}
      />
      <HubTabs />

      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Chips label={tr("Filter companies")} value={view} options={VIEW_OPTIONS} onChange={(v) => setView(v as LeadView)} />
        <div className="flex items-center gap-2">
          <Input
            aria-label={tr("Search companies")}
            placeholder={tr("Company, contact, phone or reference")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="lg:w-72"
          />
          {isDesktop ? (
            <Segmented
              label={tr("View")}
              value={mode}
              onChange={setMode}
              options={[
                { value: "list", label: tr("List") },
                { value: "board", label: tr("Board") },
              ]}
            />
          ) : null}
        </div>
      </div>

      <KpiRow>
        <KpiTile
          label={tr("Due Today")}
          value={num(tiles?.due_today ?? 0)}
          tone={due === "today" ? "warn" : "accent"}
          onClick={() => setDue(due === "today" ? "" : "today")}
        />
        <KpiTile
          label={tr("Overdue")}
          value={num(tiles?.overdue ?? 0)}
          tone={due === "overdue" || (tiles?.overdue ?? 0) > 0 ? "bad" : "accent"}
          onClick={() => setDue(due === "overdue" ? "" : "overdue")}
        />
        {moneyVisible ? (
          <KpiTile
            label={tr("Open Value")}
            value={tiles?.open_value != null ? money(tiles.open_value, tiles.open_currency || "XAF") : "—"}
            tone={hasValue ? "ok" : "accent"}
            onClick={() => setHasValue(!hasValue)}
          />
        ) : null}
      </KpiRow>

      <div className="mt-4">
        {mode === "board" ? (
          <LeadsBoard q={q} moneyVisible={moneyVisible} />
        ) : res.error ? (
          <ErrorState message={res.error} />
        ) : (
          <SplitPane
            storageKey="sales.leads"
            label={tr("Company list width")}
            defaultSize={320}
            min={240}
            max={520}
            activeKind={tr("Company")}
            active={!!selected}
            onClose={() => setSelId(null)}
            sheetTitle={selected ? selected.company_name : null}
          >
            <div className="space-y-2">
              <div className={cn("space-y-1 rounded-lg border p-1", "lg:max-h-[70vh] lg:overflow-auto")}>
                {rows === null ? (
                  <LoadingRow label={tr("Loading…")} />
                ) : rows.length === 0 ? (
                  <EmptyState
                    title={filtered ? tr("No companies match") : tr("Nothing due on your desk")}
                    action={
                      filtered ? (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setView("open");
                            setDue("");
                            setHasValue(false);
                            setSearch("");
                          }}
                        >
                          {tr("Show All Open")}
                        </Button>
                      ) : can("create") ? (
                        <Button onClick={() => setCapture(true)}>{tr("Capture Lead")}</Button>
                      ) : undefined
                    }
                  />
                ) : (
                  rows.map((r) => (
                    <LeadIndexRow key={r.lead_id} r={r} selected={r.lead_id === selId} onOpen={() => setSelId(r.lead_id)} moneyVisible={moneyVisible} />
                  ))
                )}
              </div>
              <Pagination page={page} pageSize={PAGE} total={res.data?.total} onPageChange={setPage} />
            </div>
            {selected ? (
              <LeadRecordView key={selected.lead_id} leadId={selected.lead_id} placeholder={{ title: selected.company_name }} onChanged={res.reload} />
            ) : (
              <EmptyState title={rows && rows.length ? tr("Choose a company") : tr("No company open")} />
            )}
          </SplitPane>
        )}
      </div>

      <CaptureLeadDialog
        open={capture}
        onClose={() => setCapture(false)}
        onOpenLead={(id) => {
          res.reload();
          navigate(`/sales/leads/${id}`);
        }}
      />
      <AiActions actions={LEADS_AI} />
    </section>
  );
}
