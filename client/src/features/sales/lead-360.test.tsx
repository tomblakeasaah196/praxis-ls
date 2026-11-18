/**
 * The Lead 360 screens (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.2, PR 3).
 *
 * What is pinned here, because none of it fails anywhere else when it breaks:
 *
 *   THE LOOP     Done sends what happened and what is next in ONE write; it
 *                offers "nothing next" only where the API says the company owes
 *                no step, and otherwise points at Archive.
 *   DUPLICATES   Capture Lead checks as you type, and Open It opens the company
 *                already on file instead of creating a second.
 *   STAGE BAR    a click moves the stage; Lost asks why, then asks to be sure;
 *                Mark Won says it opens the operations file; Won is never a
 *                button on the bar.
 *   DEEP LINKS   `?done=<task_id>` (My Workspace) opens Done for that task;
 *                `?request=<id>` opens the request; an old request or
 *                opportunity link resolves to the request on its company; a
 *                lead's step completed in My Workspace goes to the lead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { Route, Routes, useLocation } from "react-router-dom";
import { entityRoute } from "@shared";
import { authContextMock, renderScreen } from "@/test/screen-harness";

type Call = { path: string; method: string; body: unknown };
const calls: Call[] = [];
const routes: { current: Record<string, unknown> } = { current: {} };

function answer(path: string): unknown {
  const bare = path.split("?")[0];
  let best: string | null = null;
  for (const k of Object.keys(routes.current)) {
    if ((bare === k || bare.startsWith(k)) && (best === null || k.length > best.length)) best = k;
  }
  return best === null ? [] : routes.current[best];
}

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  const tenant = async (path: string, o: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: o.method || "GET", body: o.body });
    return answer(path);
  };
  return {
    ...actual,
    tenant,
    api: tenant,
    tenantWithProgress: async (p: string) => answer(p),
    tenantPaged: async (p: string) => ({ data: await tenant(p), total: null, limit: null, offset: null, hasMore: false, meta: null }),
  };
});
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { DoneDialog, ScheduleMeetingDialog } from "./lead-dialogs";
import { CaptureLeadDialog } from "./lead-capture";
import { RequestSheet, StageBar } from "./request-sheet";
import { LeadRecordView } from "./lead-360";
import { OpportunityLinkPage, RequestLinkPage } from "./old-links";
import { leadDoneUrl } from "@/features/workspace/lead-step";
import { newQuotationPath } from "./new-quotation";
import type { LeadDossier, LeadRecord } from "@/lib/lead-api";

const LEAD: LeadRecord = {
  lead_id: "l1",
  company_name: "Cimencam",
  status: "OPEN",
  is_client: false,
  client_id: null,
};

const DOSSIER: LeadDossier = {
  lead: LEAD,
  next_step: { task_id: "t1", action: "Call back", due_at: "2026-07-03T08:00:00Z" },
  next_step_required: true,
  counts: { activity: 0, requests: 1, quotations: 0 },
  activity: [],
  requests: [{ quote_request_id: "q1", public_ref: "SQ-2026-0042", stage: "CONTACTED" }],
  quotations: [],
  kpis: { money_visible: true },
  client: null,
};

const REQUEST = { quote_request_id: "q1", lead_id: "l1", public_ref: "SQ-2026-0042", stage: "CONTACTED", intake_channel: "WEBSITE" };

const writes = (suffix: string) => calls.filter((c) => c.method !== "GET" && c.path.endsWith(suffix));

beforeEach(() => {
  calls.length = 0;
  routes.current = {};
});

/* ═══════════════════════════════ the loop ═══════════════════════════════ */

describe("Done: what happened and what is next, in one write", () => {
  it("sends the activity and the new step together, with the task it completes", async () => {
    const onSaved = vi.fn();
    renderScreen(
      <DoneDialog open lead={LEAD} step={DOSSIER.next_step} taskId="9a1b2c3d-0000-4000-8000-000000000009" nextStepRequired onClose={() => {}} onSaved={onSaved} onArchive={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("What happened, in one line"), { target: { value: "Wants a rate to Bangui" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes("/leads/l1/next-step/done")).toHaveLength(1));
    const body = writes("/leads/l1/next-step/done")[0].body as Record<string, any>;
    expect(body.task_id).toBe("9a1b2c3d-0000-4000-8000-000000000009");
    expect(body.activity).toEqual({ kind: "CALL", body: "Wants a rate to Bangui" });
    expect(body.next_step.action).toBe("Call back");
    expect(body.next_step.due_at).toMatch(/^\d{4}-\d{2}-\d{2}T09:00$/);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("a company that owes a step is offered Archive, never 'nothing next'", () => {
    const onArchive = vi.fn();
    renderScreen(<DoneDialog open lead={LEAD} step={null} nextStepRequired onClose={() => {}} onSaved={() => {}} onArchive={onArchive} />);
    expect(screen.queryByText("Nothing next for now")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Archive Instead" }));
    expect(onArchive).toHaveBeenCalled();
  });

  it("a client with nothing open may finish with no next step", async () => {
    renderScreen(<DoneDialog open lead={LEAD} step={null} nextStepRequired={false} onClose={() => {}} onSaved={() => {}} onArchive={() => {}} />);
    fireEvent.click(screen.getByLabelText("Nothing next for now"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes("/next-step/done")).toHaveLength(1));
    expect((writes("/next-step/done")[0].body as Record<string, unknown>).next_step).toBeNull();
  });
});

/* ═══════════════════════════ the duplicate check ════════════════════════ */

describe("Capture Lead checks for the company as you type", () => {
  it("says the company is already here, and Open It opens it without creating one", async () => {
    routes.current = {
      "/leads/duplicates": {
        exact: [{ lead_id: "l1", client_id: "c1", company_name: "Cimencam", is_client: true, matched_on: ["company"], exact: true }],
        similar: [],
      },
      "/quote-requests/services": [],
    };
    const onOpenLead = vi.fn();
    renderScreen(<CaptureLeadDialog open onClose={() => {}} onOpenLead={onOpenLead} />);
    fireEvent.change(screen.getByLabelText(/Company or Person/), { target: { value: "Cimencam" } });
    expect(await screen.findByText("Already here: Cimencam", {}, { timeout: 2000 })).toBeTruthy();
    expect(calls.some((c) => c.path.startsWith("/leads/duplicates?") && c.path.includes("company_name=Cimencam"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Open It" }));
    await waitFor(() => expect(onOpenLead).toHaveBeenCalledWith("l1"));
    expect(calls.filter((c) => c.method === "POST" && c.path === "/leads")).toHaveLength(0);
  });

  it("asks for a company and one way to reach them, and nothing else", () => {
    routes.current = { "/leads/duplicates": { exact: [], similar: [] } };
    renderScreen(<CaptureLeadDialog open onClose={() => {}} onOpenLead={() => {}} />);
    const save = () => screen.getAllByRole("button", { name: "Capture Lead" }).at(-1)! as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Company or Person/), { target: { value: "Tema Shipping" } });
    expect(save().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Phone or Email/), { target: { value: "ops@tema.example" } });
    expect(save().disabled).toBe(false);
    // More Details stays shut until asked for.
    expect(screen.queryByLabelText("RCCM")).toBeNull();
  });
});

/* ═══════════════════════════ the stage bar ══════════════════════════════ */

describe("the stage bar", () => {
  it("moves a working stage on a click", async () => {
    routes.current = { "/quote-requests/q1": REQUEST };
    renderScreen(<RequestSheet requestId="q1" lead={LEAD} quotations={[]} onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Meeting" }));
    await waitFor(() => expect(writes("/quote-requests/q1/stage")).toHaveLength(1));
    expect(writes("/quote-requests/q1/stage")[0].body).toEqual({ stage: "MEETING" });
  });

  it("Lost asks why, then asks to be sure, and sends the reason", async () => {
    routes.current = { "/quote-requests/q1": REQUEST };
    renderScreen(<RequestSheet requestId="q1" lead={LEAD} quotations={[]} onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Lost" }));
    const markLost = () => screen.getAllByRole("button", { name: "Mark Lost" }).at(-1)! as HTMLButtonElement;
    expect(markLost().disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Competitor" }));
    fireEvent.change(screen.getByLabelText("In One Line"), { target: { value: "Went with their usual agent" } });
    fireEvent.click(markLost());
    const confirm = await screen.findByRole("alertdialog").catch(() => screen.findByText("Mark SQ-2026-0042 Lost?"));
    expect(confirm).toBeTruthy();
    expect(writes("/stage")).toHaveLength(0);
    fireEvent.click(markLost());
    await waitFor(() => expect(writes("/quote-requests/q1/stage")).toHaveLength(1));
    expect(writes("/quote-requests/q1/stage")[0].body).toEqual({
      stage: "LOST",
      lost_reason_code: "COMPETITOR",
      lost_reason: "Went with their usual agent",
    });
  });

  it("Mark Won says it opens the operations file before it does", async () => {
    routes.current = { "/quote-requests/q1": REQUEST };
    renderScreen(<RequestSheet requestId="q1" lead={LEAD} quotations={[]} onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark Won" }));
    expect(await screen.findByText("Mark SQ-2026-0042 Won?")).toBeTruthy();
    expect(screen.getByText(/Opens operations file for Cimencam/)).toBeTruthy();
    expect(writes("/mark-won")).toHaveLength(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Mark Won" }).at(-1)!);
    await waitFor(() => expect(writes("/quote-requests/q1/mark-won")).toHaveLength(1));
  });

  it("Won is a state the bar shows, never a button on it; a settled request reads only", () => {
    const onMove = vi.fn();
    renderScreen(<StageBar stage="WON" onMove={onMove} onLost={() => {}} />);
    const bar = screen.getByRole("list", { name: "Stage" });
    expect(within(bar).queryByRole("button", { name: "Won" })).toBeNull();
    for (const b of within(bar).getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it("Lost needs the approve grant: without it the bar still moves but cannot lose", () => {
    renderScreen(<StageBar stage="NEW" onMove={() => {}} onLost={() => {}} canLose={false} />);
    expect((screen.getByRole("button", { name: "Lost" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Contacted" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

/* ═══════════════════════════ deep links ═════════════════════════════════ */

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

describe("deep links", () => {
  it("?done=<task_id> opens Done for that task, and the parameter goes", async () => {
    routes.current = { "/leads/l1/360": DOSSIER };
    renderScreen(
      <>
        <LeadRecordView leadId="l1" />
        <Where />
      </>,
      { path: "/sales/leads/l1?done=9a1b2c3d-0000-4000-8000-000000000009" },
    );
    expect(await screen.findByText("What Happened?", { selector: "legend" })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/sales/leads/l1"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes("/leads/l1/next-step/done")).toHaveLength(1));
    expect((writes("/leads/l1/next-step/done")[0].body as Record<string, unknown>).task_id).toBe("9a1b2c3d-0000-4000-8000-000000000009");
  });

  it("?request=<id> opens the request over the company", async () => {
    routes.current = { "/leads/l1/360": DOSSIER, "/quote-requests/q1": REQUEST };
    renderScreen(<LeadRecordView leadId="l1" />, { path: "/sales/leads/l1?request=q1" });
    expect(await screen.findByRole("list", { name: "Stage" })).toBeTruthy();
    expect(screen.getAllByText("SQ-2026-0042").length).toBeGreaterThan(0);
  });

  it("an old request link opens the request on its company", async () => {
    routes.current = { "/quote-requests/q1": REQUEST };
    renderScreen(
      <Routes>
        <Route path="/sales/quote-requests/:quoteRequestId" element={<RequestLinkPage />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { path: "/sales/quote-requests/q1" },
    );
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/sales/leads/l1?request=q1"));
  });

  it("an old opportunity link opens the request it became", async () => {
    routes.current = { "/quote-requests": { rows: [REQUEST], total: 1 } };
    renderScreen(
      <Routes>
        <Route path="/sales/opportunities/:opportunityId" element={<OpportunityLinkPage />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { path: "/sales/opportunities/op1" },
    );
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/sales/leads/l1?request=q1"));
    expect(calls.some((c) => c.path.includes("converted_opportunity_id=op1"))).toBe(true);
  });

  it("old notification refs resolve through the shared route map", () => {
    expect(entityRoute.urlFor("opportunity:op1")).toBe("/sales/opportunities/op1");
    expect(entityRoute.urlFor("quote_request:q1")).toBe("/sales/quote-requests/q1");
    expect(entityRoute.urlFor("lead:l1")).toBe("/sales/leads/l1");
  });

  it("a lead's step completed in My Workspace goes to the lead's Done", () => {
    expect(leadDoneUrl({ task_id: "t9", entity_type: "lead", entity_id: "l1" }, "DONE")).toBe("/sales/leads/l1?done=t9");
    expect(leadDoneUrl({ task_id: "t9", entity_type: "lead", entity_id: "l1" }, "IN_PROGRESS")).toBeNull();
    expect(leadDoneUrl({ task_id: "t9", entity_type: "dossier", entity_id: "d1" }, "DONE")).toBeNull();
  });

  it("New Quotation opens today's create flow with the client and the request", () => {
    expect(newQuotationPath("c1", "q1")).toBe("/sales/quotations?new=1&client=c1&request=q1");
  });
});

/* ═══════════════════════════ axe, for the dialogs ═══════════════════════ */

/**
 * The request sheet and the three dialogs portal outside a screen's container,
 * which is all `screens.axe.test.tsx` scans; so they are scanned here, against
 * the whole document, open and populated.
 */
describe("the Lead 360's dialogs are axe-clean", () => {
  const scanDoc = async () => expect(await axe(document.body)).toHaveNoViolations();

  it("Capture Lead, with More Details open and a duplicate showing", async () => {
    routes.current = {
      "/leads/duplicates": { exact: [{ lead_id: "l1", client_id: null, company_name: "Cimencam", is_client: false, matched_on: ["company"], exact: true }], similar: [] },
    };
    renderScreen(<CaptureLeadDialog open onClose={() => {}} onOpenLead={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "More Details" }));
    fireEvent.change(screen.getByLabelText(/Company or Person/), { target: { value: "Cimencam" } });
    await screen.findByText("Already here: Cimencam", {}, { timeout: 2000 });
    await scanDoc();
  });

  it("Done", async () => {
    renderScreen(<DoneDialog open lead={LEAD} step={DOSSIER.next_step} nextStepRequired onClose={() => {}} onSaved={() => {}} onArchive={() => {}} />);
    await scanDoc();
  });

  it("Schedule Meeting", async () => {
    renderScreen(<ScheduleMeetingDialog open lead={LEAD} requests={DOSSIER.requests} onClose={() => {}} onSaved={() => {}} />);
    await scanDoc();
  });

  it("the request sheet, with its stage bar", async () => {
    routes.current = { "/quote-requests/q1": REQUEST, "/quote-requests/q1/attachments": [] };
    renderScreen(<RequestSheet requestId="q1" lead={LEAD} quotations={[]} onClose={() => {}} onChanged={() => {}} />);
    await screen.findByRole("list", { name: "Stage" });
    await scanDoc();
  });
});
