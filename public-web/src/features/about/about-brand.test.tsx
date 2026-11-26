import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AboutPage } from "@/features/about/about-page";
import { DocumentPage } from "@/features/trust/document-page";
import { ImpressumPage } from "@/features/legal/impressum-page";
import { TrustPage } from "@/features/trust/trust-page";
import { __resetSiteImages } from "@/lib/brand-api";
import "@/lib/i18n";

/**
 * The brand layer's pages (PR 4, 14660): the rebuilt About page's sections,
 * the trust documents and the Impressum, against stubbed reads, the way a
 * browser receives them.
 */

function stubReads(answers: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
      // Longest fragment first, so "/site/documents/quality-policy" wins over
      // "/site/documents".
      const hit = Object.entries(answers)
        .sort((a, b) => b[0].length - a[0].length)
        .find(([fragment]) => url.includes(fragment));
      if (hit) {
        return new Response(JSON.stringify({ data: hit[1] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
    }),
  );
}

beforeEach(() => __resetSiteImages());
afterEach(() => vi.unstubAllGlobals());

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";

const ABOUT = {
  headline: { fr: null, en: "We Hold Both Ends of the Line" },
  summary: { fr: null, en: "From our own offices in Douala and Mannheim." },
  mission: { fr: null, en: null },
  vision: { fr: null, en: null },
  principles: [{ label_en: "One File, One Owner", text_en: "Every shipment has a named file owner." }],
  esg: {},
  timeline: [],
  founded_year: 2021,
  headquarters: "Douala",
  leaders: [
    {
      id: "l1",
      name: "Timothée Massomba",
      role: { fr: null, en: "Managing Director" },
      bio: { fr: null, en: null },
      photo_id: null,
      photo_variants: null,
      linkedin_url: null,
    },
  ],
  sections: {
    hero_eyebrow: { en: "About Us" },
    credentials: [
      { label: { en: "Established" }, value: { en: "2021, Douala" } },
      { label: { en: "Offices" }, value: { en: "Douala · Mannheim" } },
    ],
    story: { title: { en: "Our Story" }, paragraphs: [{ en: "We began in Douala in 2021 as a customs brokerage." }] },
    principles_title: { en: "How We Work" },
    message: {
      leader_id: "l1",
      title: { en: "A Message From Our Managing Director" },
      paragraphs: [{ en: "When we opened in Douala in 2021, we did one thing." }, { en: "Five years on." }],
    },
    offices: {
      title: { en: "Two Offices" },
      items: [{ entity_id: ENTITY_ID, heading: { en: "Douala, Cameroon" }, label: { en: "Head Office" }, services: { en: "Customs brokerage" } }],
    },
    sectors: { title: { en: "Who We Move For" }, items: [{ title: { en: "Energy and Power" }, text: { en: "Transformers and towers." } }] },
    standards: { title: { en: "Our Standards" }, text: { en: "A Strategic Planning Committee sets our direction." } },
    closing: { title: { en: "Send Us the Next One" }, text: { en: "Tell us where it starts." } },
  },
};

const LEGAL = [
  {
    id: ENTITY_ID,
    legal_name: "Smart Logistics and Services Ltd",
    legal_form: null,
    country_code: "CM",
    country: "Cameroon",
    address_lines: ["1030, Avenue Douala Manga Bell", "B.P. 5120", "Douala", "Cameroon"],
    representatives: [],
    register: null,
    vat_id: null,
    email: "info@example.com",
    phone: "+237 233 420 281",
    website: null,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    legal_name: "Smart Logistics and Services UG (haftungsbeschränkt)",
    legal_form: "UG (haftungsbeschränkt)",
    country_code: "DE",
    country: "Germany",
    address_lines: ["Rheingoldstraße 103", "68199 Mannheim", "Germany"],
    representatives: [{ name: "Vanessa Mezakeu", title: "Geschäftsführerin" }],
    register: { kind: "HRB", number: "HRB 700000", authority: "Amtsgericht Mannheim" },
    vat_id: "DE123456789",
    email: null,
    phone: null,
    website: null,
  },
];

const DOCS = [
  {
    key: "quality-policy",
    kind: "POLICY",
    lang: "en",
    languages: ["en"],
    title: "Quality Policy",
    summary: "What we promise on every shipment.",
    version_label: "1.0",
    effective_on: "2026-11-25",
    published_at: "2026-11-25T10:00:00Z",
  },
];

describe("the rebuilt About page (PR 4)", () => {
  it("draws every section the tenant wrote, in order, with the offices from the company records", async () => {
    stubReads({
      "/site/about": ABOUT,
      "/site/entities": [],
      "/site/legal": LEGAL,
      "/site/partners": { partners: [], credentials: [] },
      "/site/documents": DOCS,
      "/site/images": {},
    });
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("We began in Douala in 2021 as a customs brokerage.")).toBeInTheDocument());
    expect(screen.getByText("2021, Douala")).toBeInTheDocument();
    expect(screen.getByText("One File, One Owner")).toBeInTheDocument();
    expect(screen.getByText("When we opened in Douala in 2021, we did one thing.")).toBeInTheDocument();
    expect(screen.getByText("Managing Director")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("1030, Avenue Douala Manga Bell")).toBeInTheDocument());
    expect(screen.getByText("+237 233 420 281")).toBeInTheDocument();
    expect(screen.getByText("Transformers and towers.")).toBeInTheDocument();
    // Inside the page, not the whole document: the footer lists the published
    // policies too, after paint, so whether it had arrived decided whether this
    // found one link or two. It failed main's CI on 26 Nov 2026 and passed the
    // same code in the pull request.
    await waitFor(() =>
      expect(within(screen.getByRole("main")).getByRole("link", { name: "Quality Policy" })).toBeInTheDocument(),
    );
    expect(screen.getByText("Tell us where it starts.")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("never prints an em dash from the furniture around the tenant's words", async () => {
    stubReads({
      "/site/about": ABOUT,
      "/site/legal": LEGAL,
      "/site/partners": { partners: [], credentials: [] },
      "/site/documents": DOCS,
    });
    const { container } = render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Send Us the Next One")).toBeInTheDocument());
    expect(container.textContent).not.toMatch(/—/);
  });
});

describe("a published document", () => {
  it("shows the frozen copy with its version and a PDF link", async () => {
    stubReads({
      "/site/documents/quality-policy": {
        ...DOCS[0],
        body: "## Our Commitment\n\nA client who gives us a shipment.",
        approved_by: "Managing Director",
      },
    });
    render(
      <MemoryRouter initialEntries={["/trust/quality-policy"]}>
        <Routes>
          <Route path="/trust/:key" element={<DocumentPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Quality Policy" })).toBeInTheDocument());
    expect(screen.getByText("A client who gives us a shipment.")).toBeInTheDocument();
    expect(screen.getByText("Managing Director")).toBeInTheDocument();
    const pdf = screen.getByRole("link", { name: /PDF/i });
    expect(pdf.getAttribute("href")).toContain("/public/site/documents/quality-policy/pdf?lang=en");
  });

  it("is the not-found page when the document is not published", async () => {
    stubReads({});
    render(
      <MemoryRouter initialEntries={["/trust/nothing-here"]}>
        <Routes>
          <Route path="/trust/:key" element={<DocumentPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByText("Quality Policy")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 1 }).length).toBe(1));
  });

  it("lists the published policies on Trust and Compliance", async () => {
    stubReads({ "/site/documents": DOCS, "/site/partners": { partners: [], credentials: [] }, "/site/about": ABOUT });
    render(
      <MemoryRouter>
        <TrustPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("What we promise on every shipment.")).toBeInTheDocument());
    expect(screen.getAllByRole("link", { name: /Impressum/ }).length).toBeGreaterThan(0);
  });
});

describe("the Impressum", () => {
  it("states each company's register, VAT number and representative, in English and in German", async () => {
    stubReads({ "/site/legal": LEGAL });
    render(
      <MemoryRouter>
        <ImpressumPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("HRB 700000")).toBeInTheDocument());
    expect(screen.getByText("DE123456789")).toBeInTheDocument();
    expect(screen.getByText(/Vanessa Mezakeu, Geschäftsführerin/)).toBeInTheDocument();
    screen.getByRole("button", { name: "Deutsch" }).click();
    await waitFor(() => expect(screen.getAllByText("Vertreten durch").length).toBeGreaterThan(0));
    expect(screen.getByText("Angaben gemäß § 5 DDG")).toBeInTheDocument();
  });
});
