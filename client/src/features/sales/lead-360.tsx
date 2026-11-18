/**
 * The Lead 360: one company (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.2, owner
 * decisions D2, D4, D11).
 *
 * One row per company, a Prospect until it is a Client. The header carries who
 * it is, how to reach them, and the NEXT STEP CARD with its Done button; the
 * four buttons are what a salesperson does next (New Request, Log Activity,
 * Schedule Meeting, New Quotation); the four tabs are everything that points
 * at the company (Activity, Requests, Quotations, Details).
 *
 * THE LOOP IS THE POINT. An open company always has a dated next step (the API
 * refuses otherwise). Done asks what happened and what is next in one write;
 * completing the step from My Workspace lands here as `?done=<task_id>` and
 * opens the same dialog. A request opens as a sheet over the record, linkable
 * as `?request=<id>`.
 *
 * Embedded in the Leads list (desktop: the right of the split pane; phone: a
 * sheet) and mounted on its own route `/sales/leads/:leadId`, one component so
 * the two cannot drift. Money is the API's to hide: without finance
 * visibility a value arrives null and reads "—", never 0.
 */
import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { pageShell } from "@/lib/layout";
import { useResource, errMsg } from "@/lib/use-resource";
import { useUrlTab } from "@/lib/use-url-tab";
import { useCan, useCanOpenRoute } from "@/lib/route-access";
import { cell, dateFmt, dateTimeFmt, money } from "@/lib/format";
import { channelLabel, serviceNameOf } from "@/lib/quote-request-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Pill, statusTone } from "@/components/ui/pill";
import { SectionTabs } from "@/components/ui/section-tabs";
import { MoreMenu } from "@/components/ui/more-menu";
import { DropdownItem } from "@/components/ui/dropdown-menu";
import { AccessLink } from "@/components/ui/access-link";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import {
  activityKindLabel,
  dialable,
  dueTone,
  fetchDossier,
  logActivity,
  lostReasonLabel,
  stageLabel,
  whatsappHref,
  type ActivityItem,
  type LeadDossier,
  type RequestCard,
} from "@/lib/lead-api";
import {
  ArchiveDialog,
  DoneDialog,
  EditLeadDialog,
  LogActivityDialog,
  MakeClientDialog,
  NextStepDialog,
  ReopenDialog,
  ScheduleMeetingDialog,
} from "./lead-dialogs";
import { RequestSheet } from "./request-sheet";
import { MeetingDialog } from "./meeting-dialog";
import { QuoteRequestForm } from "./quote-request-forms";
import { newQuotationPath } from "./new-quotation";
import { CLIENT_TYPE_LABEL } from "./lead-capture";

/** The four tabs (§3.2). Their values are the `?tab=` a link can carry. */
export const LEAD_TABS = ["Activity", "Requests", "Quotations", "Details"] as const;
type LeadTab = (typeof LEAD_TABS)[number];

type Dialogs = "done" | "log" | "step" | "archive" | "reopen" | "client" | "meeting" | "edit" | "request" | null;

const TONE_TEXT: Record<"bad" | "warn", string> = {
  bad: "text-[rgb(var(--bad))]",
  warn: "text-[rgb(var(--warn))]",
};

/** A date that is due: red when overdue, amber today (§3.2). */
export function DueDate({ at, className }: { at: string | null | undefined; className?: string }) {
  if (!at) return <span className={className}>—</span>;
  const tone = dueTone(at);
  return (
    <time dateTime={at} className={cn("num", tone ? TONE_TEXT[tone] : null, className)}>
      {dateTimeFmt(at)}
    </time>
  );
}

/* ═══════════════════════════════ header ═════════════════════════════════ */

function ContactLine({ phone, email }: { phone?: string | null; email?: string | null }) {
  if (!phone && !email) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {phone ? (
        <>
          <a className="text-primary-ink hover:underline" href={`tel:${dialable(phone)}`}>
            {phone}
          </a>
          <a className="text-primary-ink hover:underline" href={whatsappHref(phone)} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        </>
      ) : null}
      {email ? (
        <a className="text-primary-ink hover:underline" href={`mailto:${email}`}>
          {email}
        </a>
      ) : null}
    </p>
  );
}

function NextStepCard({
  d,
  onDone,
  onChange,
  canEdit,
}: {
  d: LeadDossier;
  onDone: () => void;
  onChange: () => void;
  canEdit: boolean;
}) {
  const step = d.next_step;
  if (d.lead.status === "ARCHIVED") {
    return (
      <div className="rounded-lg border p-3">
        <p className="micro">{tr("Archived")}</p>
        <p className="text-sm text-foreground">{cell(d.lead.archived_reason)}</p>
      </div>
    );
  }
  return (
    <section aria-label={tr("Next Step")} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="micro">{tr("Next Step")}</p>
        {step ? (
          <>
            <p className="truncate text-sm font-medium text-foreground">{step.action}</p>
            <DueDate at={step.due_at} className="text-sm" />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{d.next_step_required ? tr("None set") : tr("Nothing open")}</p>
        )}
      </div>
      {canEdit ? (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onChange}>
            {step ? tr("Change") : tr("Set Next Step")}
          </Button>
          {step ? (
            <Button size="sm" onClick={onDone}>
              {tr("Done")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* ═══════════════════════════════ Activity ═══════════════════════════════ */

const SHARE_SAYS: Record<string, string> = {
  SHARED: "Company Profile shared",
  OPENED: "Company Profile opened",
  DOWNLOADED: "Company Profile downloaded",
};
const QUOTE_SAYS: Record<string, string> = {
  SENT: "Quotation sent",
  VIEWED: "Quotation viewed",
  ACCEPTED: "Quotation accepted",
  DECLINED: "Quotation declined",
};
const STAGE_SAYS: Record<string, string> = {
  CREATED: "Request received",
  STAGE_MOVED: "Moved to",
  WON: "Won",
  LOST: "Lost",
};

/** One line of the timeline: what it was, in words, never a code. */
export function activityHeadline(i: ActivityItem): string {
  switch (i.type) {
    case "activity":
      return activityKindLabel(i.kind);
    case "meeting":
      return `${tr("Meeting")}: ${cell(i.title)}`;
    case "mail":
      return `${tr("Mail")}: ${cell(i.title)}`;
    case "quotation":
      return `${tr(QUOTE_SAYS[String(i.kind)] || "Quotation")} ${cell(i.title)}`;
    case "profile_share":
      return `${tr(SHARE_SAYS[String(i.kind)] || "Company Profile")}${i.title ? `: ${i.title}` : ""}`;
    case "stage":
      if (i.kind === "STAGE_MOVED") return `${tr("Moved to")} ${stageLabel(i.title)}`;
      return tr(STAGE_SAYS[String(i.kind)] || "Request");
    default:
      return cell(i.title);
  }
}

function ActivityTab({
  d,
  canEdit,
  onLogged,
  onOpenRequest,
  onOpenMeeting,
}: {
  d: LeadDossier;
  canEdit: boolean;
  onLogged: () => void;
  onOpenRequest: (id: string) => void;
  onOpenMeeting: (id: string) => void;
}) {
  const toast = useToast();
  const canOpen = useCanOpenRoute();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const refOf = new Map(d.requests.map((r) => [r.quote_request_id, r.public_ref || r.title || ""]));

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await logActivity(d.lead.lead_id, { kind: "NOTE", body: note.trim() });
      setNote("");
      onLogged();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  function open(i: ActivityItem): (() => void) | null {
    if (i.type === "meeting") return () => onOpenMeeting(i.ref.id);
    if (i.type === "stage" && i.quote_request_id) return () => onOpenRequest(String(i.quote_request_id));
    return null;
  }
  function href(i: ActivityItem): string | null {
    if (i.type === "mail") return `/comms/mail?thread=${encodeURIComponent(i.ref.id)}`;
    if (i.type === "quotation") return `/sales/quotations?focus=${encodeURIComponent(i.ref.id)}`;
    if (i.type === "profile_share") return "/sales/company-profile";
    return null;
  }

  return (
    <div className="space-y-3">
      {canEdit && d.lead.status !== "ARCHIVED" ? (
        <form onSubmit={(e) => void addNote(e)} className="flex gap-2">
          <Input aria-label={tr("Add a note")} placeholder={tr("Add a note")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          <Button type="submit" variant="outline" loading={busy} disabled={!note.trim()}>
            {tr("Add")}
          </Button>
        </form>
      ) : null}
      {d.activity.length === 0 ? (
        <EmptyState title={tr("Nothing yet")} />
      ) : (
        <ol className="divide-y rounded-lg border">
          {d.activity.map((i, n) => {
            const act = open(i);
            const to = href(i);
            const headline = activityHeadline(i);
            const req = i.quote_request_id ? refOf.get(String(i.quote_request_id)) : null;
            return (
              <li key={`${i.type}-${i.ref.id}-${i.kind || ""}-${n}`} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {act ? (
                      <button type="button" className="text-left hover:underline" onClick={act}>
                        {headline}
                      </button>
                    ) : to && canOpen(to.split("?")[0]) ? (
                      <AccessLink to={to} className="hover:underline">
                        {headline}
                      </AccessLink>
                    ) : (
                      headline
                    )}
                  </p>
                  {i.type === "activity" && i.body ? <p className="whitespace-pre-wrap text-sm text-foreground">{i.body}</p> : null}
                  <p className="micro">
                    {[i.author_name, req].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <time dateTime={i.at} className="num shrink-0 text-xs text-muted-foreground">
                  {dateTimeFmt(i.at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/* ═══════════════════════════════ Requests ═══════════════════════════════ */

function StageDots({ stage }: { stage: string }) {
  const steps = ["NEW", "CONTACTED", "MEETING", "QUOTED"];
  const at = steps.indexOf(stage);
  const settled = stage === "WON" || stage === "LOST";
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {steps.map((s, i) => (
        <span
          key={s}
          className={cn(
            "h-1.5 w-6 rounded-full",
            settled
              ? stage === "WON"
                ? "bg-[rgb(var(--ok))]"
                : "bg-[rgb(var(--bad))]"
              : i <= at
                ? "bg-primary"
                : "bg-muted",
          )}
        />
      ))}
    </span>
  );
}

export function requestValue(r: RequestCard, moneyVisible: boolean): string {
  if (!moneyVisible || r.estimated_value === null || r.estimated_value === undefined || r.estimated_value === "") return "—";
  return money(r.estimated_value, r.currency || "XAF");
}

function RequestsTab({ d, onOpen }: { d: LeadDossier; onOpen: (id: string) => void }) {
  if (!d.requests.length) return <EmptyState title={tr("No requests yet")} />;
  return (
    <ul className="grid gap-2 lg:grid-cols-2">
      {d.requests.map((r) => {
        const service = serviceNameOf({ name_en: r.service_name_en, name_fr: r.service_name_fr }) || r.service_category || "";
        const route = [r.origin_location, r.destination_location].filter(Boolean).join(" → ");
        return (
          <li key={r.quote_request_id}>
            <button
              type="button"
              onClick={() => onOpen(r.quote_request_id)}
              className="lux-card flex w-full flex-col gap-2 p-3 text-left transition-colors hover:border-primary/40"
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-foreground">{r.title || r.public_ref || tr("Request")}</span>
                <Pill tone={statusTone(r.stage)}>{stageLabel(r.stage)}</Pill>
              </span>
              <StageDots stage={r.stage} />
              <span className="truncate text-sm text-muted-foreground">{[service, route].filter(Boolean).join(" · ") || "—"}</span>
              <span className="flex w-full items-center justify-between gap-2 text-sm">
                <span className="micro">{[r.public_ref, channelLabel(r.intake_channel)].filter(Boolean).join(" · ")}</span>
                <span className="num font-medium text-foreground">{requestValue(r, d.kpis.money_visible)}</span>
              </span>
              {r.stage === "LOST" && r.lost_reason_code ? <span className="micro">{lostReasonLabel(r.lost_reason_code)}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ═══════════════════════════════ Quotations ═════════════════════════════ */

const QUOTE_STATUS: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  REJECTED: "Declined",
  EXPIRED: "Expired",
  CONVERTED: "Invoiced",
};

function QuotationsTab({ d }: { d: LeadDossier }) {
  if (!d.quotations.length) return <EmptyState title={tr("No quotations yet")} />;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <THead>
          <TR>
            <TH>{tr("Number")}</TH>
            <TH>{tr("Request")}</TH>
            <TH className="text-right">{tr("Total")}</TH>
            <TH>{tr("Status")}</TH>
            <TH>{tr("Viewed")}</TH>
            <TH>{tr("Valid Until")}</TH>
          </TR>
        </THead>
        <TBody>
          {d.quotations.map((q) => (
            <TR key={q.quotation_id}>
              <TD className="num font-medium">
                <AccessLink to={`/sales/quotations?focus=${q.quotation_id}`} whenDenied="text" className="hover:underline">
                  {q.doc_number || tr("Draft")}
                </AccessLink>
              </TD>
              <TD>{cell(q.request_ref || q.request_title)}</TD>
              <TD className="num text-right">{q.total_ttc === null ? "—" : money(q.total_ttc, q.currency || "XAF")}</TD>
              <TD>
                <Pill tone={statusTone(q.status)}>{tr(QUOTE_STATUS[q.status] || q.status)}</Pill>
              </TD>
              <TD className="num">{q.viewed_at ? dateFmt(q.viewed_at) : "—"}</TD>
              <TD className="num">{q.valid_until ? dateFmt(q.valid_until) : "—"}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

/* ═══════════════════════════════ Details ════════════════════════════════ */

function DetailsTab({ d, onEdit, canEdit }: { d: LeadDossier; onEdit: () => void; canEdit: boolean }) {
  const l = d.lead;
  const facts: [string, React.ReactNode][] = [
    [tr("Company or Person"), cell(l.company_name)],
    [tr("Contact Person"), cell(l.contact_name)],
    [tr("Email"), cell(l.email)],
    [tr("Phone"), cell(l.phone)],
    [tr("Country"), cell(l.country)],
    [tr("Address"), cell(l.address)],
    ["NIU", cell(l.niu)],
    ["RCCM", cell(l.rccm)],
    [tr("Client Type"), l.client_type_hint ? tr(CLIENT_TYPE_LABEL[l.client_type_hint] || l.client_type_hint) : "—"],
    [tr("Payment Terms"), l.payment_terms_days != null ? `${l.payment_terms_days} ${tr("days")}` : "—"],
    [tr("Corporate Entity"), cell(l.entity_name)],
    [tr("Source"), channelLabel(l.source)],
    [tr("Owner"), cell(l.owner_name)],
    [tr("Since"), dateFmt(l.created_at)],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {d.client ? (
          <AccessLink to={`/master/clients?focus=${d.client.client_id}`} className="btn-surface inline-flex h-9 items-center rounded-lg px-3 text-[13px] no-underline">
            {tr("Open Client Record")}
          </AccessLink>
        ) : null}
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={onEdit}>
            {tr("Edit")}
          </Button>
        ) : null}
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="micro">{k}</dt>
            <dd className="truncate text-sm text-foreground">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ═══════════════════════════════ the record ═════════════════════════════ */

function RecordSkeleton({ title }: { title?: string }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex items-center gap-3">
        <Avatar name={title || "?"} />
        <p className="text-lg font-semibold text-foreground">{title || <Skeleton className="h-5 w-48" />}</p>
      </div>
      <LoadingRow label={tr("Loading…")} />
    </div>
  );
}

export function LeadRecordView({
  leadId,
  placeholder,
  onChanged,
  titleAs: Title = "h2",
}: {
  leadId: string;
  placeholder?: { title: string };
  onChanged?: () => void;
  /** `h1` on its own page, where the company's name is the page's title. */
  titleAs?: "h1" | "h2";
}) {
  const res = useResource<LeadDossier>(() => fetchDossier(leadId), [leadId], { fresh: true });
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useUrlTab<LeadTab>(LEAD_TABS, "Activity");
  const can = useCan("MOD-20");
  const canMeet = useCan("MOD-21");
  const canQuote = useCan("MOD-27");
  const [dialog, setDialog] = React.useState<Dialogs>(null);
  const [doneTask, setDoneTask] = React.useState<string | null>(null);
  const [meetingId, setMeetingId] = React.useState<string | null>(null);
  const [meetingRequest, setMeetingRequest] = React.useState<string | null>(null);

  const d = res.data;
  const requestId = params.get("request");
  // Memoised: the request form resets whenever its seed changes, so a new
  // object on every render would wipe what is being typed.
  const lead0 = d?.lead;
  const requestSeed = React.useMemo(
    () =>
      lead0
        ? {
            lead_id: lead0.lead_id,
            client_id: lead0.client_id || null,
            client_name: lead0.client_name || null,
            requester_company: lead0.company_name,
            requester_name: lead0.contact_name || null,
            requester_email: lead0.email || null,
            requester_phone: lead0.phone || null,
          }
        : null,
    [lead0],
  );

  const reload = React.useCallback(() => {
    res.reload();
    onChanged?.();
  }, [res, onChanged]);

  // My Workspace › Done on a lead's step: `?done=<task_id>` opens the same
  // dialog, once, and the parameter goes so a refresh does not reopen it.
  const doneParam = params.get("done");
  React.useEffect(() => {
    if (!doneParam || !d) return;
    if (d.lead.status === "OPEN") {
      setDoneTask(doneParam);
      setDialog("done");
    }
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete("done");
        return p;
      },
      { replace: true },
    );
  }, [doneParam, d, setParams]);

  const openRequest = (id: string | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (id) p.set("request", id);
        else p.delete("request");
        return p;
      },
      { replace: !id },
    );

  if (res.error) return <ErrorState message={res.error} />;
  if (!d || !d.lead) return <RecordSkeleton title={placeholder?.title} />;

  const l = d.lead;
  const archived = l.status === "ARCHIVED";
  const canEdit = can("edit");
  const openCount = d.requests.filter((r) => r.stage !== "WON" && r.stage !== "LOST").length;
  const quoteTo = l.client_id ? newQuotationPath(l.client_id) : null;
  const close = () => {
    setDialog(null);
    setDoneTask(null);
  };

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={l.company_name || "?"} />
            <div className="min-w-0">
              <Title className="truncate text-lg font-semibold text-foreground">{l.company_name}</Title>
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Pill tone={l.client_id ? "ok" : "blue"}>{l.client_id ? tr("Client") : tr("Prospect")}</Pill>
                {archived ? <Pill tone="mute">{tr("Archived")}</Pill> : null}
                {l.owner_name ? <span>{l.owner_name}</span> : null}
                {l.contact_name ? <span>{l.contact_name}</span> : null}
              </p>
              <ContactLine phone={l.phone} email={l.email} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!archived && can("create") ? (
              <Button size="sm" variant="outline" onClick={() => setDialog("request")}>
                {tr("New Request")}
              </Button>
            ) : null}
            {!archived && canEdit ? (
              <Button size="sm" variant="outline" onClick={() => setDialog("log")}>
                {tr("Log Activity")}
              </Button>
            ) : null}
            {!archived && canMeet("create") ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setMeetingRequest(null);
                  setDialog("meeting");
                }}
              >
                {tr("Schedule Meeting")}
              </Button>
            ) : null}
            {quoteTo && !archived && canQuote("create") ? (
              <AccessLink to={quoteTo} className="btn-primary inline-flex h-9 items-center rounded-lg px-3 text-[13px] no-underline">
                {tr("New Quotation")}
              </AccessLink>
            ) : null}
            {canEdit ? (
              <MoreMenu label={tr("Company Actions")}>
                <DropdownItem onSelect={() => setDialog("edit")}>{tr("Edit")}</DropdownItem>
                {!l.client_id && !archived ? <DropdownItem onSelect={() => setDialog("client")}>{tr("Make Client")}</DropdownItem> : null}
                {archived ? (
                  <DropdownItem onSelect={() => setDialog("reopen")}>{tr("Reopen")}</DropdownItem>
                ) : can("approve") ? (
                  <DropdownItem destructive onSelect={() => setDialog("archive")}>
                    {tr("Archive")}
                  </DropdownItem>
                ) : null}
              </MoreMenu>
            ) : null}
          </div>
        </div>
        <NextStepCard d={d} canEdit={canEdit} onDone={() => setDialog("done")} onChange={() => setDialog("step")} />
      </header>

      <SectionTabs
        label={tr("Company Sections")}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "Activity", label: tr("Activity"), count: d.counts.activity },
          { value: "Requests", label: tr("Requests"), count: d.counts.requests },
          { value: "Quotations", label: tr("Quotations"), count: d.counts.quotations },
          { value: "Details", label: tr("Details") },
        ]}
      />

      {tab === "Activity" ? (
        <ActivityTab d={d} canEdit={canEdit} onLogged={reload} onOpenRequest={openRequest} onOpenMeeting={setMeetingId} />
      ) : tab === "Requests" ? (
        <RequestsTab d={d} onOpen={openRequest} />
      ) : tab === "Quotations" ? (
        <QuotationsTab d={d} />
      ) : (
        <DetailsTab d={d} canEdit={canEdit} onEdit={() => setDialog("edit")} />
      )}

      <DoneDialog
        open={dialog === "done"}
        lead={l}
        step={d.next_step}
        taskId={doneTask}
        nextStepRequired={d.next_step_required}
        onClose={close}
        onSaved={reload}
        onArchive={() => setDialog("archive")}
      />
      <LogActivityDialog open={dialog === "log"} lead={l} requests={d.requests} onClose={close} onSaved={reload} />
      <NextStepDialog open={dialog === "step"} lead={l} step={d.next_step} onClose={close} onSaved={reload} />
      <ArchiveDialog open={dialog === "archive"} lead={l} openRequests={openCount} onClose={close} onSaved={reload} />
      <ReopenDialog open={dialog === "reopen"} lead={l} onClose={close} onSaved={reload} />
      <MakeClientDialog open={dialog === "client"} lead={l} onClose={close} onSaved={reload} />
      <EditLeadDialog open={dialog === "edit"} lead={l} onClose={close} onSaved={reload} />
      <ScheduleMeetingDialog
        open={dialog === "meeting"}
        lead={l}
        requests={d.requests}
        initialRequestId={meetingRequest}
        onClose={close}
        onSaved={reload}
      />
      <QuoteRequestForm
        open={dialog === "request"}
        editing={null}
        initial={requestSeed}
        onClose={close}
        onSaved={(id) => {
          reload();
          if (id) openRequest(id);
        }}
      />
      <RequestSheet requestId={requestId} lead={l} quotations={d.quotations} onClose={() => openRequest(null)} onChanged={reload} />
      <MeetingDialog meetingId={meetingId} onClose={() => setMeetingId(null)} onChanged={reload} />
    </div>
  );
}

/** `/sales/leads/:leadId`: the same record on its own page, for a pasted link. */
export function LeadRecordPage() {
  const { leadId = "" } = useParams();
  return (
    <section className={`${pageShell.wide} space-y-4`}>
      <div className="micro">
        <Link to="/sales/leads" className="text-muted-foreground hover:text-foreground">
          {tr("Leads")}
        </Link>
      </div>
      {/* No PageHeader: the company's own name is this page's h1. */}
      <LeadRecordView leadId={leadId} titleAs="h1" />
    </section>
  );
}
