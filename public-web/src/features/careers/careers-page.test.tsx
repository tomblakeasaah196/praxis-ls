import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CareersPage, VacancyPage } from "./careers-page";
import { SCRIM_CARD, SCRIM_FLOOR } from "@/components/site/hero-scrim";
import { __resetSitePageCache } from "@/lib/use-site-page";
import "@/lib/i18n";

/**
 * The careers page, and specifically the state it is in most of the time (13792).
 *
 * ── WHAT THIS FILE IS ACTUALLY GUARDING ───────────────────────────────────
 *
 * A company of forty hires a handful of times a year, so an empty vacancy list
 * is this route's NORMAL state, not its edge case. What used to be rendered
 * there was a dashed box reading "No open roles right now / Please check back" —
 * on a white-label product, on the page a stranger forms their impression of the
 * tenant from.
 *
 * The three things below are each a decision that could be reverted by somebody
 * tidying up, and each would look harmless in a diff:
 *
 *   1. THE BUTTONS FOLLOW THE TENANT'S SWITCHES, both of which default OFF.
 *      Showing an application form to a tenant who never asked for one starts a
 *      pipeline nobody is reading; hiding one from a tenant who did makes the
 *      setting a lie.
 *   2. AN UNCONFIGURED TENANT STILL GETS SOMEWHERE TO GO. That is every tenant
 *      on day one, so the contact fallback is the commonest rendering of this
 *      band and not a corner of it.
 *   3. THE TENANT'S OWN BLOCKS RENDER WHETHER OR NOT ROLES ARE OPEN. Building
 *      "why work here" as empty-state decoration would mean the effort only
 *      ever reached the visitors who found nothing.
 */

const OFF = { open_applications: false, alerts_enabled: false, culture_tag: null };

const VACANCY = {
  token: "tok-1",
  title: "Customs declarant",
  department: "Customs",
  location: "Douala",
  employment_type: "FULL_TIME",
  skills_required: [],
  published_at: "2026-09-01",
  closes_on: null,
};

const CAREERS_BLOCKS = {
  key: "careers",
  blocks: [
    {
      block_id: "b1",
      type: "feature_list",
      content: {
        title: { fr: "Pourquoi nous", en: "Why work with us" },
        items: [
          {
            title: { fr: "Formation", en: "We train people" },
            text: { fr: "Chaque semaine.", en: "Every week, on the floor." },
          },
        ],
      },
    },
  ],
};

/**
 * Route each public read to its own answer. A path nobody stubbed answers 404,
 * so a request this page makes and this test did not declare fails loudly
 * rather than silently resolving.
 *
 * MOST SPECIFIC FRAGMENT FIRST. Matching is `url.includes(fragment)` and this
 * page reads three URLs that all end in the same word — `/careers`,
 * `/careers/settings/public` and `/public/site/pages/careers`. A bare
 * `/careers` entry declared first therefore answers the vacancy list to the
 * site-page read as well, and the tenant's blocks silently never arrive. Sorting
 * by length here rather than trusting the call sites to declare them in the
 * right order, because that is a footgun that only shows up as a missing band.
 */
function stubReads(answers: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
      const byLength = Object.entries(answers).sort(
        ([a], [b]) => b.length - a.length,
      );
      for (const [fragment, data] of byLength) {
        if (url.includes(fragment)) {
          return new Response(JSON.stringify({ data }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
    }),
  );
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <CareersPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  // The page cache is a module-level Map shared across renders, which is the
  // point of it in the app and a cross-test leak here.
  __resetSitePageCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("the careers page with roles open", () => {
  it("lists them, and does not draw the not-hiring band", async () => {
    stubReads({
      "/careers/settings/public": OFF,
      "/careers": [VACANCY],
      "/site/pages/careers": CAREERS_BLOCKS,
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Customs declarant")).toBeInTheDocument(),
    );
    expect(screen.queryByText("No open roles right now")).not.toBeInTheDocument();
  });

  it("still renders the tenant's own blocks — they are not empty-state decoration", async () => {
    stubReads({
      "/careers/settings/public": OFF,
      "/careers": [VACANCY],
      "/site/pages/careers": CAREERS_BLOCKS,
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Why work with us")).toBeInTheDocument(),
    );
    expect(screen.getByText("Every week, on the floor.")).toBeInTheDocument();
  });

  /**
   * The thing the feature exists for: a visitor who scrolled a list that HAD
   * roles, none of them theirs, can still ask to hear about the next one. The
   * empty-state tests below guard the same offer when nothing is open; this
   * guards it on the populated page, where the only way to it used to be not
   * existing.
   */
  it("offers the alert band under the list when the tenant has alerts on", async () => {
    stubReads({
      "/careers/settings/public": { ...OFF, alerts_enabled: true },
      "/careers": [VACANCY],
      "/site/pages/careers": CAREERS_BLOCKS,
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Customs declarant")).toBeInTheDocument(),
    );
    // The tailored band heading, and the alert CTA that reveals the form.
    expect(screen.getByText(/Not the right role this time/i)).toBeInTheDocument();
    const cta = await screen.findByRole("button", {
      name: /Tell me when a role opens/i,
    });
    await userEvent.click(cta);
    await waitFor(() =>
      expect(screen.getByText("Hear about the next one")).toBeInTheDocument(),
    );
  });

  it("draws no under-list band when both switches are off", async () => {
    stubReads({
      "/careers/settings/public": OFF,
      "/careers": [VACANCY],
      "/site/pages/careers": CAREERS_BLOCKS,
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Customs declarant")).toBeInTheDocument(),
    );
    // The band follows the tenant's switches on the populated page exactly as it
    // does on the empty one: both off means no invitation, not an empty heading.
    expect(screen.queryByText(/Not the right role this time/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Tell me when a role opens/i }),
    ).not.toBeInTheDocument();
  });
});

describe("the careers page with nothing open", () => {
  it("gives an unconfigured tenant a contact route, not a dead end", async () => {
    stubReads({ "/careers/settings/public": OFF, "/careers": [] });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No open roles right now")).toBeInTheDocument(),
    );
    // The claim that is true here and is not true of most careers pages.
    expect(
      screen.getByText(/closes itself on its date/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Get in touch" }),
    ).toBeInTheDocument();
    // Neither switch is on, so neither action is offered.
    expect(screen.queryByRole("button", { name: /Send your CV/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Tell me when a role opens/i }),
    ).not.toBeInTheDocument();
  });

  it("offers the CV form only when the tenant switched open applications on", async () => {
    stubReads({
      "/careers/settings/public": { ...OFF, open_applications: true },
      "/careers": [],
    });
    renderPage();

    const cta = await screen.findByRole("button", { name: /Send your CV/i });
    // No alert button: the two switches are independent, because a tenant may
    // want CVs without committing to write back to anybody.
    expect(
      screen.queryByRole("button", { name: /Tell me when a role opens/i }),
    ).not.toBeInTheDocument();

    await userEvent.click(cta);
    await waitFor(() =>
      expect(screen.getByText("Send us your CV")).toBeInTheDocument(),
    );
    /* `find*`, not `get*`: the candidate form is deferred (see
       candidate-form-lazy.tsx — it carries the upload engine, which is why the
       careers route fits its own budget). So this also asserts the thing the
       deferral could break, which is that the form ACTUALLY ARRIVES rather than
       leaving a placeholder where a CV box should be. */
    expect(
      await screen.findByLabelText(/The kind of work you are looking for/i),
    ).toBeInTheDocument();
    /* And the CV control, which is the shared `FileInput` rather than a copy of
       the upload engine — asserted by its LABEL, so the assertion survives the
       control being restyled and fails if the form ever grows its own picker
       again. */
    expect(await screen.findByLabelText("Your CV")).toBeInTheDocument();
  });

  it("offers the alert form only when the tenant switched alerts on", async () => {
    stubReads({
      "/careers/settings/public": { ...OFF, alerts_enabled: true },
      "/careers": [],
    });
    renderPage();

    const cta = await screen.findByRole("button", {
      name: /Tell me when a role opens/i,
    });
    expect(screen.queryByRole("button", { name: /Send your CV/i })).not.toBeInTheDocument();

    await userEvent.click(cta);
    await waitFor(() =>
      expect(screen.getByText("Hear about the next one")).toBeInTheDocument(),
    );
    // The consent line is part of the offer, not small print somewhere else.
    expect(
      screen.getByText("Used for job alerts and nothing else."),
    ).toBeInTheDocument();
  });

  it("offers both when both are on", async () => {
    stubReads({
      "/careers/settings/public": {
        open_applications: true,
        alerts_enabled: true,
        culture_tag: null,
      },
      "/careers": [],
    });
    renderPage();

    await screen.findByRole("button", { name: /Send your CV/i });
    expect(
      screen.getByRole("button", { name: /Tell me when a role opens/i }),
    ).toBeInTheDocument();
    // And the contact fallback steps aside — it is the answer for a tenant with
    // nothing to offer, not a third button.
    expect(screen.queryByRole("link", { name: "Get in touch" })).not.toBeInTheDocument();
  });

  it("treats a 404 on the vacancy list as an empty list, not a failure", async () => {
    // A tenant who has never published a role, or one without the package.
    stubReads({ "/careers/settings/public": OFF });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No open roles right now")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

/**
 * A role with a photograph (14720).
 *
 * The owner's brief: a role HR gave a picture to looks like a recruitment
 * poster on the list and opens on that picture; a role without one looks
 * exactly as it did. Both halves are pinned, because the second is the one a
 * redesign quietly breaks.
 */
describe("a role's careers photo", () => {
  const COVER = {
    id: "11111111-2222-3333-4444-555555555555",
    variants: { widths: [480, 960], formats: ["avif", "webp"] },
  };
  const WITH_PHOTO = { ...VACANCY, token: "tok-2", title: "Customer Service Officer", location_city: "Douala", cover: COVER };

  it("draws a role with a photo as a photo card, with its words as live text", async () => {
    stubReads({
      "/careers/settings/public": OFF,
      "/careers": [WITH_PHOTO, VACANCY],
      "/site/pages/careers": CAREERS_BLOCKS,
    });
    const { container } = renderPage();

    const title = await screen.findByRole("heading", { name: "Customer Service Officer" });
    const card = title.closest("a")!;
    expect(card).toHaveAttribute("href", expect.stringContaining("/careers/tok-2"));
    // The picture, at the widths that exist, behind the words: decorative,
    // because the title already says what it is.
    const img = card.querySelector("img")!;
    expect(img).toHaveAttribute("src", `/api/tenant/public/site/media/${COVER.id}`);
    expect(img).toHaveAttribute("alt", "");
    expect(card.querySelector('source[type="image/avif"]')?.getAttribute("srcset")).toContain("/960.avif 960w");
    // Where and on what terms, once, in the eyebrow; not again as chips.
    expect(card).toHaveTextContent(/Douala/);
    expect(card.textContent!.match(/Douala/g)).toHaveLength(1);

    // The role with no photo is the plain row it always was.
    const plain = screen.getByRole("heading", { name: "Customs declarant" }).closest("a")!;
    expect(plain.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("opens the role's own page on its photo", async () => {
    stubReads({ "/careers/tok-2": { ...WITH_PHOTO, environment: "live" } });
    render(
      <MemoryRouter initialEntries={["/careers/tok-2"]}>
        <Routes>
          <Route path="/careers/:token" element={<VacancyPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const h1 = await screen.findByRole("heading", { level: 1, name: "Customer Service Officer" });
    const band = h1.closest("section")!;
    expect(band).toHaveClass("photo-band");
    expect(band.querySelector("img")).toHaveAttribute("src", `/api/tenant/public/site/media/${COVER.id}`);
  });

  it("keeps the plain header for a role without one", async () => {
    stubReads({ "/careers/tok-1": { ...VACANCY, environment: "live", cover: null } });
    render(
      <MemoryRouter initialEntries={["/careers/tok-1"]}>
        <Routes>
          <Route path="/careers/:token" element={<VacancyPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const h1 = await screen.findByRole("heading", { level: 1, name: "Customs declarant" });
    expect(h1.closest("section")).not.toHaveClass("photo-band");
  });

  it("holds every stop under the card's words to the hero's floor", () => {
    // The words sit over the foot of the card; the stops marked `over` are
    // where they are, and a recruiter's blown-out photo must not wash them out.
    const over = SCRIM_CARD.stops.filter((s) => s.over);
    expect(over.length).toBeGreaterThan(0);
    for (const stop of over) expect(stop.alpha).toBeGreaterThanOrEqual(SCRIM_FLOOR);
    expect(SCRIM_CARD.shape).toMatch(/0deg/);
  });
});
