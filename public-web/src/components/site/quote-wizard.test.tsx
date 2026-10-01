import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrandingProvider } from "@/app/branding";
import { QuoteWizard } from "@/components/site/quote-wizard";
import { en } from "@/lib/i18n-dict";
import type { ServiceCard } from "@/lib/services-api";

/**
 * The wizard, judged against what WS2 said it must beat.
 *
 * Their form is `onsubmit="return false;"` with the real submit on a button's
 * onclick, so every `required` on the page is decorative and native validation
 * never runs. The cases below are therefore mostly about REFUSALS — a step that
 * will not advance, an incoterm that cannot be skipped, a warehousing branch
 * that never asks for one — because a wizard that always advances looks
 * identical to a correct one until somebody submits.
 *
 * The ones about the payload are the ones a reviewer should read first: the
 * request carries the SERVICE TYPE the visitor reached through the cards
 * (meeting 6, PR 2), an Incoterm is always sent — one the service offers, or
 * TBD for "not sure" — documents travel with it, and no coordinate is ever
 * posted.
 */

const ANY_MODE = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP"];
const ALL = ["EXW", "FCA", "FAS", "FOB", "CPT", "CIP", "CFR", "CIF", "DAP", "DPU", "DDP"];
const terms = (codes: string[]) => codes.map((code) => ({ code, name_en: `${code} name`, name_fr: `${code} nom`, sea_only: ["FAS", "FOB", "CFR", "CIF"].includes(code) }));

/** A published service as /public/services sends it (14300: card, flow, Incoterms). */
const svc = (id: string, name: string, card: string, flow: string | null, codes: string[], shape = "ROUTE"): ServiceCard =>
  ({
    service_type_id: id,
    slug_en: id,
    slug_fr: id,
    name_en: name,
    name_fr: name,
    mode: card === "STORAGE" ? "WAREHOUSE" : card,
    card,
    flow,
    incoterms: terms(codes),
    enquiry_shape: shape,
    short_description_en: null,
    short_description_fr: null,
    claim_en: null,
    claim_fr: null,
    accent: "PRIMARY",
    cover_url: null,
    icon_url: null,
    has_video: false,
    sort_order: null,
    published_month: null,
  }) as unknown as ServiceCard;

const SERVICES: ServiceCard[] = [
  svc("s-sea-imp", "Sea Freight Import", "SEA", "IMPORT", ALL),
  svc("s-sea-exp", "Sea Freight Export", "SEA", "EXPORT", ALL),
  svc("s-air-imp", "Air Freight Import", "AIR", "IMPORT", ANY_MODE),
  svc("s-rail-hin", "Rail Hinterland Transit", "RAIL", "HINTERLAND", ANY_MODE),
  svc("s-rail-inl", "Rail Transportation", "RAIL", "INLAND", ANY_MODE),
  svc("s-wh", "Warehousing", "STORAGE", "INLAND", [], "STORAGE"),
  svc("s-cus", "Customs Brokerage", "CUSTOMS", null, ALL),
  svc("s-proj", "Project Cargo", "OTHER", "END_TO_END", ALL),
];

const responses: Array<{ url: RegExp; body: unknown; status?: number }> = [];

// Both parameters are declared, not just `url`: `sentBody` below reads the
// RequestInit to see what was posted, and a one-parameter mock gives call
// tuples of length 1 that no cast can index.
const stubFetch = () =>
  vi.fn(async (url: unknown, init?: RequestInit) => {
    void init;
    const u = String(url);
    const match = responses.find((r) => r.url.test(u));
    const body = match ? match.body : { error: { code: "NOT_FOUND", message: "no" } };
    return new Response(JSON.stringify(body), {
      status: match?.status ?? (match ? 200 : 404),
      headers: { "content-type": "application/json" },
    });
  });

let fetchMock: ReturnType<typeof stubFetch>;

const mount = async (services: ServiceCard[] = SERVICES) => {
  const view = render(
    <BrandingProvider>
      <QuoteWizard services={services} />
    </BrandingProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
};

/**
 * Match a field by the START of its label.
 *
 * `field.tsx` renders the required marker INSIDE the `<label>`, so a required
 * field's accessible name is "Service*" and an exact string match finds
 * nothing — while the same query works for every optional field, which is the
 * kind of half-passing that hides a real breakage.
 */
const labelRe = (label: string) =>
  new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

const field = (label: string) => screen.getByLabelText(labelRe(label));

const type = (label: string, value: string) =>
  fireEvent.change(field(label), { target: { value } });

const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

/**
 * Pick a card, then (when the card holds several services) a flow.
 *
 * RADIOS, not buttons: a single choice among several is what a radio group
 * is, and the semantics buy arrow-key navigation, one tab stop and an "n of 6"
 * announcement. Asserting on the role keeps that from being quietly reverted.
 */
const choose = (name: string) =>
  fireEvent.click(screen.getByRole("radio", { name: new RegExp("^" + name) }));

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

/** Fill step 1 (Sea → Import by default) and advance. */
async function stepNeed(card: string = en.site.quote.modeSEA, flow: string | null = en.site.quote.flowIMPORT) {
  choose(card);
  if (flow) choose(flow);
  press(en.site.quote.next);
  await settle();
}

/** Fill the freight route step (FOB) and advance. */
async function stepRoute(term: string | null = "FOB") {
  type(en.site.quote.originPort, "Shanghai");
  type(en.site.quote.destinationPort, "Douala");
  if (term) choose(term);
  press(en.site.quote.next);
  await settle();
}

/** From the details step, through the (optional) documents step, to the contact step. */
async function toContact() {
  press(en.site.quote.next);
  await screen.findByRole("heading", { name: en.site.quote.stepDocuments });
  press(en.site.quote.next);
  await screen.findByLabelText(labelRe(en.site.quote.name));
}

async function fillContactAndSend() {
  type(en.site.quote.name, "Ada Mballa");
  type(en.site.quote.email, "ada@example.cm");
  press(en.site.quote.submit);
  await waitFor(() => expect(sentBody()).toBeTruthy());
}

beforeEach(() => {
  responses.length = 0;
  responses.push({
    url: /\/public\/intake\/quote-requests/,
    body: { data: { received: true, reference: "SQ-2026-0007" } },
    status: 201,
  });
  fetchMock = stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const sentBody = () => {
  const call = fetchMock.mock.calls.find((c) =>
    String(c[0]).includes("/public/intake/quote-requests"),
  );
  return JSON.parse(String(call?.[1]?.body));
};

describe("a step will not advance while it is incomplete", () => {
  it("refuses the first step with nothing chosen", async () => {
    // Their `required` attributes never fire because the form's own submit is
    // cancelled. Ours is the reason the button exists.
    await mount();
    press(en.site.quote.next);
    expect(await screen.findByText(en.site.quote.errMode)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: en.site.quote.stepNeed })).toBeInTheDocument();
  });

  it("refuses a card with several services until the flow is chosen", async () => {
    await mount();
    choose(en.site.quote.modeSEA);
    press(en.site.quote.next);
    expect(await screen.findByText(en.site.quote.errFlow)).toBeInTheDocument();
  });

  it("says nothing until an attempt is made", async () => {
    // Pointing at a field somebody has not reached yet is nagging.
    await mount();
    expect(screen.queryByText(en.site.quote.errMode)).not.toBeInTheDocument();
  });

  it("refuses the route step without both ends", async () => {
    await mount();
    await stepNeed();
    type(en.site.quote.originPort, "Shanghai");
    press(en.site.quote.next);
    expect(await screen.findByText(en.site.quote.errDestination)).toBeInTheDocument();
  });

  it("asks for nothing on the details or documents steps", async () => {
    // Every field there is a nicety that makes a better quote, and a stranger
    // may not have an invoice yet (owner decision Q6).
    await mount();
    await stepNeed();
    await stepRoute();
    await toContact();
    expect(screen.getByRole("heading", { name: en.site.quote.stepContact })).toBeInTheDocument();
  });
});

describe("the first step is six cards, read off the tenant's services (owner decision Q1)", () => {
  it("draws only the cards the tenant offers, in order, under a Transport label", async () => {
    await mount();
    const group = screen.getByRole("group", { name: en.site.quote.mode });
    const cards = within(group).getAllByRole("radio").map((r) => r.closest("label")?.textContent || "");
    expect(cards.map((c) => c.split(/(?=[A-Z])/)[0])).toBeTruthy();
    for (const card of [en.site.quote.modeSEA, en.site.quote.modeAIR, en.site.quote.modeRAIL, en.site.quote.modeSTORAGE, en.site.quote.modeCUSTOMS]) {
      expect(within(group).getByRole("radio", { name: new RegExp("^" + card) })).toBeInTheDocument();
    }
    // No road service published here, so no Road card.
    expect(within(group).queryByRole("radio", { name: new RegExp("^" + en.site.quote.modeROAD) })).toBeNull();
    expect(within(group).getByText(en.site.quote.transport)).toBeInTheDocument();
  });

  it("names the tenant's own services under each card", async () => {
    await mount();
    expect(screen.getByText("Sea Freight Import")).toBeInTheDocument();
    expect(screen.getByText("Rail Hinterland Transit")).toBeInTheDocument();
  });

  it("offers only the flows that exist under the card", async () => {
    await mount();
    choose(en.site.quote.modeRAIL);
    const flow = screen.getByRole("group", { name: en.site.quote.flow });
    expect(within(flow).getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual([
      en.site.quote.flowINLAND,
      en.site.quote.flowHINTERLAND,
    ]);
  });

  it("asks into or out of the hinterland for a hinterland transit (owner decision Q2)", async () => {
    await mount();
    choose(en.site.quote.modeRAIL);
    choose(en.site.quote.flowHINTERLAND);
    press(en.site.quote.next);
    expect(await screen.findByText(en.site.quote.errHinterland)).toBeInTheDocument();
    choose(en.site.quote.hinterlandINTO);
    press(en.site.quote.next);
    await screen.findByLabelText(labelRe(en.site.quote.originPlace));
  });

  it("skips the flow for a card holding one service", async () => {
    await mount();
    choose(en.site.quote.modeSTORAGE);
    expect(screen.queryByRole("group", { name: en.site.quote.flow })).toBeNull();
    press(en.site.quote.next);
    expect(await screen.findByLabelText(labelRe(en.site.quote.warehouseLocation))).toBeInTheDocument();
  });

  it("keeps a service no card describes under Other services", async () => {
    await mount();
    expect(screen.queryByText("Project Cargo")).toBeNull();
    press(en.site.quote.otherServices);
    choose("Project Cargo");
    press(en.site.quote.next);
    await screen.findByLabelText(labelRe(en.site.quote.originPlace));
  });

  it("shows two services that share a card and a flow by their names", async () => {
    await mount([...SERVICES, svc("s-sea-imp-2", "Sea Freight Import (LCL)", "SEA", "IMPORT", ALL)]);
    choose(en.site.quote.modeSEA);
    const flow = screen.getByRole("group", { name: en.site.quote.flow });
    const names = within(flow).getAllByRole("radio").map((r) => r.closest("label")?.textContent);
    expect(names).toEqual(["Sea Freight Import", "Sea Freight Import (LCL)", en.site.quote.flowEXPORT]);
  });
});

describe("the Incoterms are the service's own (owner decision Q3)", () => {
  it("offers a sea service all eleven, plus Not sure", async () => {
    await mount();
    await stepNeed();
    const group = screen.getByRole("group", { name: en.site.quote.incoterm });
    expect(within(group).getAllByRole("radio")).toHaveLength(12);
    expect(within(group).getByRole("radio", { name: new RegExp("^" + en.site.quote.incotermNotSure) })).toBeChecked();
  });

  it("offers an air service the seven any-mode terms only — no FOB", async () => {
    await mount();
    await stepNeed(en.site.quote.modeAIR, null);
    const group = screen.getByRole("group", { name: en.site.quote.incoterm });
    expect(within(group).getAllByRole("radio")).toHaveLength(8);
    expect(within(group).queryByRole("radio", { name: /^FOB/ })).toBeNull();
  });
});

describe("the step indicator", () => {
  it("says how far through the form the visitor is", async () => {
    await mount();
    expect(screen.getByText(en.site.quote.stepCounter.replace("{{step}}", "1").replace("{{total}}", "5"))).toBeInTheDocument();
  });

  it("advances the counter with the step", async () => {
    await mount();
    await stepNeed();
    expect(screen.getByText(en.site.quote.stepCounter.replace("{{step}}", "2").replace("{{total}}", "5"))).toBeInTheDocument();
  });
});

describe("the branch", () => {
  it("asks a storage enquiry for a place and a duration, not for a route", async () => {
    await mount();
    choose(en.site.quote.modeSTORAGE);
    press(en.site.quote.next);
    expect(await screen.findByLabelText(labelRe(en.site.quote.warehouseLocation))).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: en.site.quote.incoterm })).toBeNull();
    expect(screen.queryByLabelText(labelRe(en.site.quote.originPort))).not.toBeInTheDocument();
  });

  it("names the route fields after the card", async () => {
    await mount();
    await stepNeed(en.site.quote.modeAIR, null);
    expect(await screen.findByLabelText(labelRe(en.site.quote.originAirport))).toBeInTheDocument();
    expect(screen.queryByLabelText(labelRe(en.site.quote.originPort))).not.toBeInTheDocument();
  });
});

describe("the step dots", () => {
  it("go back to a completed step without losing what is ahead", async () => {
    await mount();
    await stepNeed();
    await stepRoute();
    const nav = within(screen.getByRole("navigation", { name: en.site.quote.stepsLabel }));
    fireEvent.click(nav.getByRole("button", { name: new RegExp(en.site.quote.stepNeed) }));
    await waitFor(() => expect(screen.getByRole("heading", { name: en.site.quote.stepNeed })).toBeInTheDocument());
    press(en.site.quote.next);
    await waitFor(() => expect(field(en.site.quote.originPort)).toHaveValue("Shanghai"));
  });

  it("offers no way to jump forward past a step's validation", async () => {
    await mount();
    const nav = within(screen.getByRole("navigation", { name: en.site.quote.stepsLabel }));
    expect(nav.queryByRole("button", { name: new RegExp(en.site.quote.stepContact) })).not.toBeInTheDocument();
  });
});

describe("what reaches the endpoint", () => {
  it("sends the service type, the Incoterm, the route and the service's name", async () => {
    await mount();
    await stepNeed();
    await stepRoute();
    await toContact();
    await fillContactAndSend();
    const body = sentBody();
    expect(body.service_type_id).toBe("s-sea-imp");
    expect(body.service_category).toBe("Sea Freight Import");
    expect(body.incoterm).toBe("FOB");
    expect(body.origin_location).toBe("Shanghai");
    expect(body.destination_location).toBe("Douala");
    expect(body.requester_email).toBe("ada@example.cm");
  });

  it("sends TBD when the visitor is not sure of the term", async () => {
    await mount();
    await stepNeed();
    await stepRoute(null);
    await toContact();
    await fillContactAndSend();
    expect(sentBody().incoterm).toBe("TBD");
  });

  it("sends the hinterland direction with a hinterland transit", async () => {
    await mount();
    choose(en.site.quote.modeRAIL);
    choose(en.site.quote.flowHINTERLAND);
    choose(en.site.quote.hinterlandOUT_OF);
    press(en.site.quote.next);
    await settle();
    type(en.site.quote.originPlace, "Bangui");
    type(en.site.quote.destinationPlace, "Douala");
    press(en.site.quote.next);
    await settle();
    await toContact();
    await fillContactAndSend();
    expect(sentBody()).toMatchObject({ service_type_id: "s-rail-hin", hinterland_direction: "OUT_OF" });
  });

  it("sends N/A as the incoterm for storage, which is an answer", async () => {
    await mount();
    choose(en.site.quote.modeSTORAGE);
    press(en.site.quote.next);
    await screen.findByLabelText(labelRe(en.site.quote.warehouseLocation));
    type(en.site.quote.warehouseLocation, "Douala");
    press(en.site.quote.next);
    await screen.findByLabelText(labelRe(en.site.quote.weight));
    await toContact();
    await fillContactAndSend();
    expect(sentBody().incoterm).toBe("N/A");
    expect(sentBody().warehouse_location).toBe("Douala");
    expect(sentBody()).not.toHaveProperty("origin_location");
  });

  it("files the pre-launch request in words, with no service type and TBD", async () => {
    // Nothing published yet: every card is offered and the service is typed.
    await mount([]);
    choose(en.site.quote.modeSEA);
    type(en.site.quote.service, "Sea freight import");
    press(en.site.quote.next);
    await settle();
    type(en.site.quote.originPort, "Shanghai");
    type(en.site.quote.destinationPort, "Douala");
    expect(screen.queryByRole("group", { name: en.site.quote.incoterm })).toBeNull();
    press(en.site.quote.next);
    await settle();
    await toContact();
    await fillContactAndSend();
    expect(sentBody()).not.toHaveProperty("service_type_id");
    expect(sentBody()).toMatchObject({ service_category: "Sea freight import", incoterm: "TBD" });
  });

  it("carries a document, with what it is, in the request itself — with its progress", async () => {
    // A request with documents goes up over XHR, for the 0→100 % bar.
    const posted: string[] = [];
    class FakeXHR {
      status = 0;
      responseText = "";
      upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      getResponseHeader() {
        return null;
      }
      send(body: string) {
        posted.push(body);
        setTimeout(() => {
          this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
          this.status = 201;
          this.responseText = JSON.stringify({ data: { received: true, reference: "SQ-2026-0008" } });
          this.onload?.();
        }, 0);
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    await mount();
    await stepNeed();
    await stepRoute();
    press(en.site.quote.next);
    await screen.findByRole("heading", { name: en.site.quote.stepDocuments });
    expect(screen.getByText(en.site.quote.docsWhy)).toBeInTheDocument();
    const input = screen.getByLabelText(en.site.quote.docsAdd) as HTMLInputElement;
    const file = new File(["%PDF-1.4 invoice"], "invoice.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText("invoice.pdf");
    press(en.site.quote.next);
    await screen.findByLabelText(labelRe(en.site.quote.name));
    type(en.site.quote.name, "Ada Mballa");
    type(en.site.quote.email, "ada@example.cm");
    press(en.site.quote.submit);
    expect(await screen.findByText("SQ-2026-0008")).toBeInTheDocument();
    const docs = JSON.parse(posted[0]).documents;
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ filename: "invoice.pdf", document_kind: "COMMERCIAL_INVOICE" });
    expect(String(docs[0].data_url)).toMatch(/^data:application\/pdf;base64,/);
  });

  it("never posts a coordinate", async () => {
    await mount();
    await stepNeed();
    await stepRoute();
    await toContact();
    await fillContactAndSend();
    const json = JSON.stringify(sentBody());
    expect(json).not.toContain("latitude");
    expect(json).not.toContain("longitude");
  });

  it("stamps the timer the spam trap needs, and carries a FILLED honeypot", async () => {
    // A person leaves `website_url` empty and the payload cleaner drops it; a
    // bot fills it, the value travels, and `z.string().max(0)` refuses it.
    await mount();
    await stepNeed();
    await stepRoute();
    await toContact();
    type(en.site.quote.name, "Ada Mballa");
    type(en.site.quote.email, "ada@example.cm");
    const honeypot = document.querySelector<HTMLInputElement>('input[name="website_url"]');
    expect(honeypot).not.toBeNull();
    fireEvent.change(honeypot as HTMLInputElement, { target: { value: "http://spam.example" } });
    press(en.site.quote.submit);
    await waitFor(() => expect(sentBody()).toBeTruthy());
    expect(sentBody().website_url).toBe("http://spam.example");
    expect(typeof sentBody().form_started_at).toBe("number");
  });
});

describe("the draft", () => {
  it("survives a remount, so a refresh does not wipe the steps", async () => {
    const first = await mount();
    await stepNeed();
    type(en.site.quote.originPort, "Shanghai");
    await settle();
    first.unmount();

    await mount();
    press(en.site.quote.next);
    await waitFor(() => expect(field(en.site.quote.originPort)).toHaveValue("Shanghai"));
  });

  it("is kept out of localStorage", async () => {
    await mount();
    await stepNeed();
    expect(sessionStorage.length).toBeGreaterThan(0);
    expect(localStorage.length).toBe(0);
  });

  it("is cleared once the request is filed", async () => {
    await mount();
    await stepNeed();
    await stepRoute();
    await toContact();
    await fillContactAndSend();
    await waitFor(() => expect(screen.getByText(en.site.quote.sent)).toBeInTheDocument());
    expect(sessionStorage.getItem("praxis.quote.draft")).toBeNull();
  });
});

describe("the receipt", () => {
  it("shows the reference the API generated", async () => {
    await mount();
    await stepNeed();
    await stepRoute();
    await toContact();
    await fillContactAndSend();
    expect(await screen.findByText("SQ-2026-0007")).toBeInTheDocument();
  });

  it("shows a designed error rather than an alert when the post fails", async () => {
    responses.length = 0;
    responses.push({
      url: /\/public\/intake\/quote-requests/,
      body: { error: { code: "ERROR", message: "boom" } },
      status: 500,
    });
    await mount();
    await stepNeed();
    await stepRoute();
    await toContact();
    await fillContactAndSend();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(en.site.quote.err)).toBeInTheDocument();
  });
});

/**
 * ── §8.3: STAGING THAT DOES NOT COST THE FORM ANYTHING ─────────────────────
 *
 * The section asks for staged step transitions and real progress depth, and
 * then names the two things that must not happen: the entrance must not delay
 * the form, and a field must never animate into place under a cursor. Both are
 * invisible in a screenshot and both are one refactor from returning, so both
 * are asserted here.
 *
 * The draft autosave has its own describe block above; this one adds the case
 * that the staging specifically endangers, because the panel now REMOUNTS on
 * every step change and a remount is exactly how a form loses state.
 */
describe("the step transition (§8.3)", () => {
  it("does not animate on the first step — the form is there on arrival", async () => {
    const { container } = await mount();
    // §8.3: "an entrance that does not delay the form". The CTA of the whole
    // site lands here, and an arrival animation on step one is the one place a
    // delay would cost a real enquiry.
    expect(container.querySelector(".step-panel")).toBeNull();
    expect(container.querySelector(".step-head")).toBeNull();
  });

  it("animates once the visitor has moved", async () => {
    const { container } = await mount();
    await stepNeed();
    expect(container.querySelector(".step-panel")).not.toBeNull();
    expect(container.querySelector(".step-head")).not.toBeNull();
  });

  it("NEVER puts a field inside a transform — §8.3's hard rule", async () => {
    /*
     * "Never animate a field into place under a cursor."
     *
     * `.step-head` rises and fades; `.step-panel` fades only. A control still
     * moving when the pointer arrives is a control that gets mis-clicked, and
     * on this form that is a lost enquiry. So the assertion is structural: no
     * form control may live inside the element that carries the transform.
     */
    const { container } = await mount();
    await stepNeed();
    const rising = container.querySelector(".step-head") as HTMLElement;
    expect(rising).not.toBeNull();
    expect(
      rising.querySelectorAll("input, select, textarea, button"),
    ).toHaveLength(0);

    // …and the fields ARE inside the fading panel, so the test would still fail
    // if somebody moved the controls out of both.
    const panel = container.querySelector(".step-panel") as HTMLElement;
    expect(
      panel.querySelectorAll("input, select, textarea").length,
    ).toBeGreaterThan(0);
  });

  it("keeps the draft across the remount the transition introduces", async () => {
    /*
     * THE REGRESSION THIS SECTION WAS WARNED ABOUT.
     *
     * The panel is keyed by step so React replays the animation, which means it
     * UNMOUNTS and REMOUNTS on every step change. `CLAUDE.md` names the quote
     * wizard's autosave defect — a save landing after a discard — as the reason
     * native dialogs are banned here, and a remount is precisely how a form's
     * answers get written back in the wrong order or dropped.
     *
     * They survive because the answers live in the wizard's own state and not
     * in the panel's, so this asserts the boundary rather than the animation.
     */
    await mount();
    await stepNeed();
    type(en.site.quote.originPort, "Shanghai");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // Back and forward across the animated boundary, twice.
    press(en.common.back);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    press(en.site.quote.next);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(field(en.site.quote.originPort)).toHaveValue("Shanghai");
    const draft = sessionStorage.getItem("praxis.quote.draft");
    expect(draft).toContain("Shanghai");
  });

  it("still clears the draft on submit after crossing the transition", async () => {
    // The other half of the same risk: a remount that re-armed the autosave
    // effect could write the draft back AFTER `clear()` ran — which is the
    // save-after-discard shape by name.
    await mount();
    await stepNeed();
    await stepRoute();
    await toContact();
    await fillContactAndSend();
    await waitFor(() =>
      expect(screen.getByText(en.site.quote.sent)).toBeInTheDocument(),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(sessionStorage.getItem("praxis.quote.draft")).toBeNull();
  });

  it("gives the step strip real depth, not colour alone", async () => {
    const { container } = await mount();
    await stepNeed();
    // Greyscale-safe: the step you are on is lifted, the one behind rests.
    expect(container.querySelectorAll(".stepper-dot-here")).toHaveLength(1);
    expect(
      container.querySelectorAll(".stepper-dot-done").length,
    ).toBeGreaterThan(0);
  });
});
