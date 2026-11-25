import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrandingProvider } from "@/app/branding";
import { QuoteWizard } from "@/components/site/quote-wizard";
import { en } from "@/lib/i18n-dict";
import { en as steps } from "@/components/quote/quote-steps-copy";
import { en as qe } from "@/components/quote/quote-engine-copy";
import type { QuoteRule, ServiceCard } from "@/lib/services-api";

/**
 * The quote wizard over WEBSITE SERVICES (SmartLS website v2, PR 3).
 *
 * The visitor picks "Sea Freight", then answers the quote engine's questions
 * on "Your Terms": importing or exporting, whether they know their Incoterm,
 * and if not, three plain questions. The step names the term in a sentence and
 * lists what we handle. The request carries the website service and the
 * answers, never a service type or a term of the browser's choosing: the server
 * runs the same engine and decides.
 */

const ALL = ["EXW", "FCA", "FAS", "FOB", "CPT", "CIP", "CFR", "CIF", "DAP", "DPU", "DDP"];
const ANY = ["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP"];
const GENERIC: QuoteRule[] = [
  ["IMPORT", "O", "DESK"], ["IMPORT", "M", "IMPORT"], ["IMPORT", "D", "IMPORT"], ["IMPORT", "OM", "IMPORT"],
  ["IMPORT", "MD", "IMPORT"], ["IMPORT", "OMD", "END_TO_END"], ["EXPORT", "O", "EXPORT"], ["EXPORT", "M", "EXPORT"],
  ["EXPORT", "D", "DESK"], ["EXPORT", "OM", "EXPORT"], ["EXPORT", "MD", "EXPORT"], ["EXPORT", "OMD", "END_TO_END"],
].map(([direction, span, outcome]) => ({ website_service_id: null, direction, span, outcome, service_type_id: null }));

const web = (id: string, name: string, card: string, members: [string, string, string | null, string[]][], shape = "ROUTE"): ServiceCard =>
  ({
    service_type_id: id,
    slug_en: id,
    slug_fr: id,
    name_en: name,
    name_fr: name,
    mode: card,
    card,
    flow: null,
    incoterms: [],
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
    quote: {
      card,
      asks: card !== "ROAD",
      members: members.map(([mid, mname, flow, codes]) => ({ service_type_id: mid, name_en: mname, name_fr: mname, flow, incoterms: codes })),
      rules: GENERIC,
    },
  }) as unknown as ServiceCard;

const SERVICES: ServiceCard[] = [
  web("w-sea", "Sea Freight", "SEA", [
    ["t-sea-imp", "Sea Freight Import", "IMPORT", ALL],
    ["t-sea-exp", "Sea Freight Export", "EXPORT", ALL],
    ["t-sea-e2e", "End-to-End Sea Freight", "END_TO_END", ALL],
  ]),
  web("w-air", "Air Freight", "AIR", [
    ["t-air-exp", "Air Freight Export", "EXPORT", ANY],
    ["t-air-imp", "Air Freight Import", "IMPORT", ANY],
  ]),
  web("w-road", "Road Transport", "ROAD", [["t-road", "Inland Transportation", "INLAND", ANY]]),
];

let fetchMock: ReturnType<typeof vi.fn>;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const choose = (name: string | RegExp) => fireEvent.click(screen.getByRole("radio", { name: typeof name === "string" ? new RegExp("^" + name) : name }));
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const labelRe = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(labelRe(label)), { target: { value } });
const sentBody = () => {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/public/intake/quote-requests"));
  return JSON.parse(String(call?.[1]?.body));
};

async function mount() {
  render(
    <BrandingProvider>
      <QuoteWizard services={SERVICES} />
    </BrandingProvider>,
  );
  await settle();
}

async function toTerms(name = "Sea Freight") {
  choose(name);
  press(en.site.quote.next);
  await screen.findByRole("heading", { name: steps.stepTerms });
  await screen.findByText(steps.questionDirection);
}

async function finish() {
  press(en.site.quote.next);
  await settle();
  type(en.site.quote.originPort, "Shanghai");
  type(en.site.quote.destinationPort, "Douala");
  press(en.site.quote.next);
  await settle();
  press(en.site.quote.next);
  await screen.findByRole("heading", { name: en.site.quote.stepDocuments });
  press(en.site.quote.next);
  await screen.findByLabelText(labelRe(en.site.quote.name));
  type(en.site.quote.name, "Ada Mballa");
  type(en.site.quote.email, "ada@example.cm");
  press(en.site.quote.submit);
  await waitFor(() => expect(sentBody()).toBeTruthy());
}

beforeEach(() => {
  fetchMock = vi.fn(async (url: unknown) => {
    const ok = String(url).includes("/public/intake/quote-requests");
    return new Response(JSON.stringify(ok ? { data: { received: true, reference: "SQ-1" } } : { error: { code: "NOT_FOUND" } }), {
      status: ok ? 201 : 404,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("the wizard over website services", () => {
  it("asks its questions as sentences, not in Title Case", async () => {
    await mount();
    await toTerms();
    expect(screen.getByText("Are you importing or exporting?")).toBeInTheDocument();
  });

  it("lists website services by their website names, never the import/export split", async () => {
    await mount();
    expect(screen.getByRole("radio", { name: /^Sea Freight$/ })).toBeInTheDocument();
    expect(screen.queryByText("End-to-End Sea Freight")).not.toBeInTheDocument();
    expect(screen.queryByText("Sea Freight Import")).not.toBeInTheDocument();
  });

  it("knowing the term: importing on DDP names the term and the work, and sends only the answers", async () => {
    await mount();
    await toTerms();
    choose(qe.directionIMPORT);
    choose(qe.knowsYES);
    choose("DDP");
    expect(await screen.findByText(/^This is DDP:/)).toBeInTheDocument();
    expect(screen.getByText("Duties and Taxes")).toBeInTheDocument();
    await finish();
    const body = sentBody();
    expect(body.website_service_id).toBe("w-sea");
    expect(body.quote_answers).toEqual({ direction: "IMPORT", knows: "YES", incoterm: "DDP" });
    expect(body.service_type_id).toBeUndefined();
    expect(body.incoterm).toBeUndefined();
  });

  it("not knowing it: buying from the supplier's premises to my premises is EXW", async () => {
    await mount();
    await toTerms();
    choose(qe.directionIMPORT);
    choose(/^No(?!t)/);
    choose(qe.partyBUYER);
    choose(qe.pointSUPPLIER_PREMISES_BUYER);
    choose(/^Your Premises$/);
    expect(await screen.findByText(/^This is EXW:/)).toBeInTheDocument();
    await finish();
    expect(sentBody().quote_answers).toEqual({
      direction: "IMPORT", knows: "NO", party: "BUYER", start: "SUPPLIER_PREMISES", end: "PREMISES",
    });
  });

  it("offers an air service no sea-only term", async () => {
    await mount();
    await toTerms("Air Freight");
    choose(qe.directionEXPORT);
    choose(qe.knowsYES);
    expect(screen.getByRole("radio", { name: /^CIP/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /^FOB/ })).not.toBeInTheDocument();
  });

  it("will not leave Your Terms with a question unanswered", async () => {
    await mount();
    await toTerms();
    choose(qe.directionIMPORT);
    press(en.site.quote.next);
    expect(await screen.findByText(steps.errTerms)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: steps.stepTerms })).toBeInTheDocument();
  });

  it("changing an earlier answer clears the ones that depended on it", async () => {
    await mount();
    await toTerms();
    choose(qe.directionIMPORT);
    choose(qe.knowsYES);
    choose("CIF");
    choose(/^No(?!t)/);
    expect(screen.queryByText(/^This is CIF:/)).not.toBeInTheDocument();
    expect(screen.getByText(steps.questionParty)).toBeInTheDocument();
  });

  it("puts no terms question for a service with nothing to decide", async () => {
    await mount();
    choose("Road Transport");
    press(en.site.quote.next);
    await settle();
    expect(screen.queryByRole("heading", { name: steps.stepTerms })).not.toBeInTheDocument();
  });
});
