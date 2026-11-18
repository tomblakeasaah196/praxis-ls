/**
 * The quotation editor, the templates screen and New Quotation
 * (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md §3.4, §3.5, PR 6).
 *
 * What is pinned here, because none of it fails anywhere else when it breaks:
 *
 *   THE SWITCH     Full Proposal | Commercial Extract changes which sections
 *                  print and the output the preview asks for, never a number:
 *                  it saves `default_output` alone and the totals stay put.
 *   ACTIONS        Send posts To, Cc, Subject, Message and the output; Revise,
 *                  Revoke and Record Acceptance each ask first, and Record
 *                  Acceptance says it opens the operations file.
 *   TEMPLATES      words are saved per section and language; starring one
 *                  makes it the default.
 *   NEW QUOTATION  a prospect gets one too: the draft is made from the company
 *                  row and the editor opens on it.
 *   OLD LINKS      `?focus=<id>` and a proposal's own link open the editor.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { entityRoute } from "@shared";
import { authContextMock, renderScreen } from "@/test/screen-harness";

type Call = { path: string; method: string; body: unknown };
const calls: Call[] = [];
const routes: { current: Record<string, unknown> } = { current: {} };

function answer(path: string, method: string): unknown {
  const bare = path.split("?")[0];
  let best: string | null = null;
  for (const k of Object.keys(routes.current)) {
    const [m, p] = k.includes(" ") ? k.split(" ") : ["GET", k];
    if (m !== method && !(m === "GET" && method === "GET")) continue;
    if ((bare === p || bare.startsWith(p)) && (best === null || k.length > best.length)) best = k;
  }
  return best === null ? [] : routes.current[best];
}

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  const tenant = async (path: string, o: { method?: string; body?: unknown } = {}) => {
    const method = o.method || "GET";
    calls.push({ path, method, body: o.body });
    return answer(path, method);
  };
  return {
    ...actual,
    tenant,
    api: tenant,
    tenantPaged: async (p: string) => ({ data: await tenant(p), total: null, limit: null, offset: null, hasMore: false, meta: null }),
  };
});
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { QuotationEditorPage } from "./quotation-editor";
import { QuotationTemplatesPage } from "./quotation-templates";
import { QuotationsPage } from "./quotations";
import { printedSections, SECTION_KEYS } from "./quotation-words";
import { ProposalLinkPage } from "@/features/sales/old-links";
import { LeadRecordView } from "@/features/sales/lead-360";

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const NEXT = "1f0e0d0c-0b0a-4908-8706-050403020101";

const SECTIONS = SECTION_KEYS.map((k) => ({ section_key: k, enabled: true, body_en: null, body_fr: null, story_ids: [] }));

function quotation(over: Record<string, unknown> = {}) {
  return {
    quotation_id: ID,
    doc_number: "QT-2026-001",
    title: null,
    status: "DRAFT",
    version: 1,
    client_id: null,
    client_name: null,
    lead_name: "Cimencam",
    lead: { lead_id: "l1", company_name: "Cimencam", client_id: null },
    entity_id: "2f0e0d0c-0b0a-4908-8706-050403020102",
    currency: "XAF",
    quote_model: "HT_ON_TOP",
    language: "EN",
    languages: ["EN"],
    default_output: "FULL",
    template_id: "t1",
    total_ht: 1_000_000,
    total_ttc: 1_192_500,
    margin_percent: null,
    own_cost_total: null,
    valid_until: "2026-12-31",
    lines: [{ quotation_line_id: "ql1", dictionary_item_id: null, label: "Road haulage", qty: 1, unit_price: 1_000_000, is_disbursement: false, tax_code_id: null }],
    sections: SECTIONS,
    quote_request: { quote_request_id: "r1", public_ref: "SQ-2026-0042", stage: "QUOTED", title: null, lead_id: "l1" },
    costing: null,
    workings: null,
    views: [],
    open_revision_id: null,
    share_active: false,
    updated_at: "2026-11-18T08:00:00Z",
    ...over,
  };
}

const TEMPLATES = [
  { template_id: "t1", name: "Standard", service_type_ids: [], is_default: true, active: true, sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, { enabled: true }])) },
  { template_id: "t2", name: "Customs", service_type_ids: [], is_default: false, active: true, sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, { enabled: k !== "case_stories" }])) },
];

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function editorAt(q: Record<string, unknown>) {
  routes.current = {
    [`/quotations/${ID}/preview`]: { html: "<p>Preview</p>", language: "EN", output: "FULL" },
    [`/quotations/${ID}`]: q,
    "/quotations/templates": TEMPLATES,
    "/settings/commercial/quotation": { value: { target_margin_percent: 0 } },
    "/leads/l1": { lead_id: "l1", email: "buyer@cimencam.cm" },
  };
  return renderScreen(
    <Routes>
      <Route path="/sales/quotations/:quotationId" element={<QuotationEditorPage />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { path: `/sales/quotations/${ID}` },
  );
}

const writes = (suffix: string) => calls.filter((c) => c.method !== "GET" && c.path.split("?")[0].endsWith(suffix));

beforeEach(() => {
  calls.length = 0;
  routes.current = {};
});

/* ═══════════════════════════════ the switch ═════════════════════════════ */

describe("Full Proposal | Commercial Extract changes which sections print, never a number", () => {
  it("the Extract prints the cover, Pricing, Terms and Next Steps; Pricing always", () => {
    const allOn = () => true;
    expect(printedSections("EXTRACT", allOn)).toEqual(["cover", "pricing", "terms", "next_steps"]);
    expect(printedSections("FULL", allOn)).toEqual([...SECTION_KEYS]);
    expect(printedSections("FULL", () => false)).toEqual(["pricing"]);
    expect(printedSections("EXTRACT", () => false)).toEqual(["pricing"]);
  });

  it("switching saves the output alone and the totals stay as they were", async () => {
    editorAt(quotation());
    await screen.findByRole("heading", { name: /QT-2026-001/ });
    const before = screen.getByText(/Saved Total TTC/).textContent;
    routes.current[`PATCH /quotations/${ID}`] = quotation({ default_output: "EXTRACT", updated_at: "2026-11-18T08:01:00Z" });
    fireEvent.click(screen.getByRole("radio", { name: "Commercial Extract" }));
    await waitFor(() => expect(writes(`/quotations/${ID}`)).toHaveLength(1));
    expect(writes(`/quotations/${ID}`)[0].body).toEqual({ default_output: "EXTRACT" });
    await waitFor(() => expect(calls.some((c) => c.path.includes("/preview?output=EXTRACT"))).toBe(true));
    expect(screen.getByText(/Saved Total TTC/).textContent).toBe(before);
    // The sections the Extract leaves out are marked, never removed.
    expect(screen.getAllByText("Not in the Extract").length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════ the actions ════════════════════════════ */

describe("actions on a quotation", () => {
  it("Send posts To, Cc, Subject, Message and the output, To defaulting to the company's email", async () => {
    editorAt(quotation());
    await screen.findByRole("heading", { name: /QT-2026-001/ });
    routes.current[`POST /quotations/${ID}/send`] = {
      quotation: quotation({ status: "SENT" }),
      link: { url: "https://site.example/q/tok", expires_at: "2026-12-31T23:59:59Z" },
      mail: { delivered: true, suppressed: false, reason: null, attached: true, to: "buyer@cimencam.cm", cc: [] },
    };
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect((within(dialog).getByLabelText(/^To/) as HTMLInputElement).value).toBe("buyer@cimencam.cm"));
    fireEvent.change(within(dialog).getByLabelText(/^Cc/), { target: { value: "ops@cimencam.cm" } });
    fireEvent.change(within(dialog).getByLabelText(/^Message/), { target: { value: "As discussed." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send Quotation" }));
    await waitFor(() => expect(writes("/send")).toHaveLength(1));
    const body = writes("/send")[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ to: "buyer@cimencam.cm", cc: ["ops@cimencam.cm"], message: "As discussed.", output: "FULL", language: "EN", follow_up: true });
    expect(String(body.subject)).toContain("QT-2026-001");
    expect(await screen.findByText(/Sent to buyer@cimencam.cm/)).toBeInTheDocument();
  });

  it("Revise asks first, then opens the new version", async () => {
    editorAt(quotation({ status: "SENT", share_active: true, sent_at: "2026-11-10T09:00:00Z" }));
    await screen.findByRole("heading", { name: /QT-2026-001/ });
    routes.current["POST /quotations/" + ID + "/revise"] = quotation({ quotation_id: NEXT, version: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Quotation actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Revise" }));
    const confirm = await screen.findByRole("dialog");
    expect(within(confirm).getByText(/version 2/)).toBeInTheDocument();
    expect(writes("/revise")).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole("button", { name: "Revise Quotation" }));
    await waitFor(() => expect(writes("/revise")).toHaveLength(1));
    // The editor reopens on version 2.
    await waitFor(() => expect(calls.some((c) => c.method === "GET" && c.path === `/quotations/${NEXT}`)).toBe(true));
  });

  it("Revoke asks first, as a destructive confirm, then revokes", async () => {
    editorAt(quotation({ status: "SENT", share_active: true, sent_at: "2026-11-10T09:00:00Z" }));
    await screen.findByRole("heading", { name: /QT-2026-001/ });
    routes.current["POST /quotations/" + ID + "/share/revoke"] = quotation({ status: "SENT", share_active: false });
    await userEvent.click(screen.getByRole("button", { name: "Quotation actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Revoke Link" }));
    const confirm = await screen.findByRole("dialog");
    expect(within(confirm).getByText(/Cimencam: the link stops working/)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Revoke Link" }));
    await waitFor(() => expect(writes("/share/revoke")).toHaveLength(1));
  });

  it("Record Acceptance names what it does before it does it", async () => {
    editorAt(quotation({ status: "SENT", share_active: true, sent_at: "2026-11-10T09:00:00Z" }));
    await screen.findByRole("heading", { name: /QT-2026-001/ });
    routes.current["POST /quotations/" + ID + "/accept"] = { quotation: quotation({ status: "ACCEPTED" }), invoice_id: null };
    await userEvent.click(screen.getByRole("button", { name: "Quotation actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Record Acceptance" }));
    const confirm = await screen.findByRole("dialog");
    expect(within(confirm).getByText(/Opens operations file for Cimencam\. Makes Cimencam a client\./)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Record Acceptance" }));
    await waitFor(() => expect(writes("/accept")).toHaveLength(1));
  });

  it("a sent quotation is read only: no line editing, no section switches", async () => {
    editorAt(quotation({ status: "SENT", sent_at: "2026-11-10T09:00:00Z" }));
    await screen.findByRole("heading", { name: /QT-2026-001/ });
    expect(screen.queryByRole("button", { name: "Save Lines" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import From Costing" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send Again" })).toBeInTheDocument();
  });
});

/* ═══════════════════════════════ templates ══════════════════════════════ */

describe("Templates: the leanest builder", () => {
  it("saves a section's words per language, and starring one makes it the default", async () => {
    routes.current = {
      "/quotations/templates": TEMPLATES,
      "/quote-requests/services": [],
      "PATCH /quotations/templates/t1": TEMPLATES[0],
      "PATCH /quotations/templates/t2": { ...TEMPLATES[1], is_default: true },
    };
    renderScreen(<QuotationTemplatesPage />);
    await screen.findByText("Customs");
    const solution = screen.getByLabelText("Our Solution EN");
    fireEvent.change(solution, { target: { value: "Door to door, every week." } });
    fireEvent.blur(solution);
    await waitFor(() => expect(writes("/quotations/templates/t1")).toHaveLength(1));
    expect(writes("/quotations/templates/t1")[0].body).toEqual({ sections: { solution: { body_en: "Door to door, every week." } } });

    fireEvent.click(screen.getByText("Customs"));
    fireEvent.click(await screen.findByRole("button", { name: "Make Default" }));
    await waitFor(() => expect(writes("/quotations/templates/t2")).toHaveLength(1));
    expect(writes("/quotations/templates/t2")[0].body).toEqual({ is_default: true });
  });

  it("offers no reordering, no custom sections and no colours: only the fixed nine", async () => {
    routes.current = { "/quotations/templates": TEMPLATES, "/quote-requests/services": [] };
    renderScreen(<QuotationTemplatesPage />);
    await screen.findByText("Customs");
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Cover", "About Us", "Your Needs", "Our Solution", "Scope of Services", "Pricing", "Terms", "Case Stories", "Next Steps",
    ]);
    expect(screen.queryByRole("button", { name: /Add Section|Move Up|Colour/i })).toBeNull();
  });
});

/* ═══════════════════════════════ New Quotation ══════════════════════════ */

describe("New Quotation for a prospect", () => {
  it("makes the draft from the company row and opens the editor", async () => {
    routes.current = {
      "/leads/l1/360": {
        lead: { lead_id: "l1", company_name: "Cimencam", status: "OPEN", is_client: false, client_id: null },
        next_step: { task_id: "t1", action: "Call back", due_at: "2026-12-03T08:00:00Z" },
        next_step_required: true,
        counts: { activity: 0, requests: 0, quotations: 0 },
        activity: [],
        requests: [],
        quotations: [],
        kpis: { money_visible: true },
        client: null,
      },
      "POST /quotations": quotation({ quotation_id: NEXT }),
    };
    renderScreen(
      <Routes>
        <Route path="/sales/leads/:leadId" element={<LeadRecordView leadId="l1" />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { path: "/sales/leads/l1" },
    );
    fireEvent.click(await screen.findByRole("button", { name: "New Quotation" }));
    await waitFor(() => expect(writes("/quotations")).toHaveLength(1));
    expect(writes("/quotations")[0].body).toEqual({ lead_id: "l1", client_id: null, quote_request_id: null });
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/sales/quotations/${NEXT}`));
  });
});

/* ═══════════════════════════════ old links ══════════════════════════════ */

describe("old links open the editor", () => {
  it("`?focus=<id>` on the list opens that quotation's editor", async () => {
    renderScreen(
      <Routes>
        <Route path="/sales/quotations" element={<QuotationsPage />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { path: `/sales/quotations?focus=${ID}` },
    );
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/sales/quotations/${ID}`));
  });

  it("a proposal's link opens the quotation it became", async () => {
    routes.current = { "/quotations": [{ quotation_id: ID }] };
    renderScreen(
      <Routes>
        <Route path="/sales/proposals/:proposalId" element={<ProposalLinkPage />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { path: "/sales/proposals/p1" },
    );
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`/sales/quotations/${ID}`));
    expect(calls.some((c) => c.path.includes("source_proposal_id=p1"))).toBe(true);
  });

  it("a proposal with no quotation lands on the list", async () => {
    routes.current = { "/quotations": [] };
    renderScreen(
      <Routes>
        <Route path="/sales/proposals/:proposalId" element={<ProposalLinkPage />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { path: "/sales/proposals/p9" },
    );
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/sales/quotations"));
  });

  it("notification refs for a quotation and an old proposal resolve through the shared route map", () => {
    expect(entityRoute.urlFor(`quotation:${ID}`)).toBe(`/sales/quotations/${ID}`);
    expect(entityRoute.urlFor("proposal:p1")).toBe("/sales/proposals/p1");
  });
});
