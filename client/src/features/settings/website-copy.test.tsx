import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * Settings › Website › Wording.
 *
 * ── WHAT THESE PIN, AND WHY EACH ONE WOULD HAVE SHIPPED ───────────────────
 *
 *   1. THE DEFAULT IS A PLACEHOLDER, NEVER A VALUE. Pre-filling the shipped
 *      sentence is the obvious implementation and it silently freezes every
 *      tenant's wording at the deploy they first opened this screen on — an
 *      override is stored verbatim, so a tenant who never touched a field would
 *      still be opted out of every later improvement to it. The field must be
 *      empty with the sentence behind it in grey.
 *
 *   2. WHAT IS SAVED IS ONLY WHAT WAS TYPED. Falling back to the default when
 *      building the payload turns "I edited one heading" into 465 overrides,
 *      which is the same defect wearing a different hat and much harder to
 *      undo.
 *
 *   3. FRENCH IS REQUIRED. `bi()` makes FR the half every renderer falls back
 *      to, so English-only is a 422. Discovering that after typing forty rows
 *      is the experience this screen exists to avoid.
 *
 *   4. SAVED IS NOT LIVE. The overlay read is published-only. A tenant who
 *      saves, visits their site and sees no change, with nothing explaining
 *      why, is the trap the draft notice is here to close.
 */

const CATALOGUE = {
  sections: [
    { key: "portfolioPage", label: "Our work (case notes)", pages: ["Our work"] },
    { key: "footer", label: "Footer", pages: ["Home", "Contact"] },
  ],
  entries: [
    {
      key: "site.portfolioPage.titleMain",
      section: "portfolioPage",
      label: "Title main",
      default_en: "Success",
      default_fr: "Nos",
    },
    {
      key: "site.portfolioPage.sub",
      section: "portfolioPage",
      label: "Sub",
      default_en: "Operations we have run, in our own words.",
      default_fr: "Des opérations que nous avons menées, dans nos mots.",
      hideable: true,
    },
    {
      key: "site.footer.legal",
      section: "footer",
      label: "Legal",
      default_en: "All rights reserved.",
      default_fr: "Tous droits réservés.",
    },
  ],
};

/** Pages the tenant has. Empty by default — the ordinary first visit, where the
 *  copy row does not exist yet and the first save has to create it. */
let pages: unknown[] = [];
let pageTab: unknown = null;
/** The languages the site offers. Most of this suite pins the bilingual rule
 *  (French offered, French required); the English-only block switches it. */
let languages: ("en" | "fr")[] = ["en", "fr"];
const calls: { path: string; opts?: { method?: string; body?: unknown } }[] = [];

vi.mock("@/lib/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ...actual,
    tenant: vi.fn(async (path: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ path, opts });
      if (path === "/site/copy/catalogue") return CATALOGUE;
      if (path === "/site/meta") {
        return {
          website_enabled: true,
          metrics: [],
          languages,
          required_language: languages.includes("fr") ? "fr" : "en",
        };
      }
      if (path === "/site/pages" && !opts?.method) return pages;
      if (path === "/site/pages" && opts?.method === "POST") {
        const body = opts.body as { key: string };
        const row = { page_id: "p-copy", key: body.key, is_published: false };
        pages = [row];
        return row;
      }
      if (path.startsWith("/site/pages/") && !opts?.method) return pageTab;
      if (path.startsWith("/site/pages/") && path.endsWith("/blocks")) {
        return { block_id: "b-1", type: "copy_overrides", content: opts?.body };
      }
      if (path.startsWith("/site/blocks/")) {
        return { block_id: "b-1", type: "copy_overrides", content: (opts?.body as { content: unknown })?.content };
      }
      return [];
    }),
  };
});

import { WebsiteCopyPage } from "./website-copy";
import { __resetSiteMeta } from "@/lib/site-content-api";

beforeEach(() => {
  pages = [];
  pageTab = null;
  languages = ["en", "fr"];
  calls.length = 0;
  __resetSiteMeta();
});

const mount = () =>
  render(
    <MemoryRouter>
      <WebsiteCopyPage />
    </MemoryRouter>,
  );

/** The last body sent to a block write, whichever endpoint took it. */
const savedItems = () => {
  const write = [...calls]
    .reverse()
    .find((c) => c.opts?.method && (c.path.endsWith("/blocks") || c.path.startsWith("/site/blocks/")));
  const body = write?.opts?.body as { content?: { items?: unknown[] }; items?: unknown[] };
  return (body?.content?.items ?? body?.items ?? []) as { key: string; value: { fr: string; en: string | null } }[];
};

describe("the wording screen", () => {
  it("shows the shipped sentence as a placeholder, not as a value", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Our work/i }));

    const french = await screen.findByPlaceholderText(
      "Des opérations que nous avons menées, dans nos mots.",
    );
    // The sentence is visible to the tenant AND the field is empty, which is
    // what makes "leave it blank to keep ours" a true statement.
    expect(french).toHaveValue("");
    expect(
      screen.getByPlaceholderText("Operations we have run, in our own words."),
    ).toHaveValue("");
  });

  it("saves only the rows the tenant actually wrote", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Our work/i }));

    const french = await screen.findByPlaceholderText(
      "Des opérations que nous avons menées, dans nos mots.",
    );
    await userEvent.type(french, "Des dossiers que nous avons pilotés.");
    await userEvent.click(screen.getByRole("button", { name: /Save wording/i }));

    await waitFor(() => expect(savedItems()).toHaveLength(1));
    expect(savedItems()[0]).toEqual({
      key: "site.portfolioPage.sub",
      value: { fr: "Des dossiers que nous avons pilotés.", en: null },
    });
  });

  it("creates the copy page on the first save and never before", async () => {
    mount();
    await screen.findByRole("button", { name: /Our work/i });
    // Opening the screen must not leave a row behind.
    expect(calls.some((c) => c.opts?.method === "POST")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: /Our work/i }));
    await userEvent.type(
      await screen.findByPlaceholderText("Nos"),
      "Nos références",
    );
    await userEvent.click(screen.getByRole("button", { name: /Save wording/i }));

    await waitFor(() =>
      expect(
        calls.find((c) => c.path === "/site/pages" && c.opts?.method === "POST"),
      ).toBeTruthy(),
    );
    const created = calls.find(
      (c) => c.path === "/site/pages" && c.opts?.method === "POST",
    );
    expect((created?.opts?.body as { key: string }).key).toBe("site-copy");
  });

  it("refuses to save an English-only override when French is offered", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Our work/i }));
    // The required half is decided by the site's languages, read once.
    await waitFor(() => expect(calls.some((c) => c.path === "/site/meta")).toBe(true));

    await userEvent.type(
      await screen.findByPlaceholderText("Operations we have run, in our own words."),
      "Work we have run.",
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Save wording/i })).toBeDisabled(),
    );
    expect(screen.getByText(/French is required/i)).toBeInTheDocument();
  });

  it("on an English-only site, saves English with no French", async () => {
    languages = ["en"];
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Our work/i }));
    await waitFor(() => expect(calls.some((c) => c.path === "/site/meta")).toBe(true));

    await userEvent.type(
      await screen.findByPlaceholderText("Operations we have run, in our own words."),
      "Work we have run.",
    );
    const save = screen.getByRole("button", { name: /Save wording/i });
    await waitFor(() => expect(save).not.toBeDisabled());
    await userEvent.click(save);

    await waitFor(() => expect(savedItems()).toHaveLength(1));
    expect(savedItems()[0]).toEqual({
      key: "site.portfolioPage.sub",
      value: { fr: null, en: "Work we have run." },
    });
  });

  it("hides an optional line, and offers no hide on a line that cannot go", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Our work/i }));

    // One hideable line in the section (the subtitle), so exactly one control.
    const hide = await screen.findAllByRole("checkbox", { name: /Hide this line/i });
    expect(hide).toHaveLength(1);
    await userEvent.click(hide[0]);
    expect(screen.getByText(/Visitors see nothing here/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Save wording/i }));
    await waitFor(() => expect(savedItems()).toHaveLength(1));
    expect(savedItems()[0]).toEqual({ key: "site.portfolioPage.sub", hidden: true });
  });

  it("says the wording is not live while the page is a draft", async () => {
    pages = [{ page_id: "p-copy", key: "site-copy", is_published: false }];
    pageTab = {
      page: pages[0],
      blocks: [
        {
          block_id: "b-1",
          type: "copy_overrides",
          content: {
            items: [
              { key: "site.footer.legal", value: { fr: "Tous droits.", en: null } },
            ],
          },
        },
      ],
    };
    mount();

    expect(await screen.findByText(/Not live yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Publish wording/i })).toBeInTheDocument();
  });

  it("loads an existing override into its field", async () => {
    pages = [{ page_id: "p-copy", key: "site-copy", is_published: true }];
    pageTab = {
      page: pages[0],
      blocks: [
        {
          block_id: "b-1",
          type: "copy_overrides",
          content: {
            items: [
              {
                key: "site.portfolioPage.titleMain",
                value: { fr: "Nos références", en: "Reference" },
              },
            ],
          },
        },
      ],
    };
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /Our work/i }));

    expect(await screen.findByDisplayValue("Nos références")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Reference")).toBeInTheDocument();
  });

  it("finds a row by the sentence a tenant can actually see", async () => {
    mount();
    await screen.findByRole("button", { name: /Our work/i });

    await userEvent.type(
      screen.getByLabelText(/Search the wording/i),
      "Operations we have run",
    );

    // The matching section opens itself, and the section that does not match is
    // gone entirely rather than sitting there empty.
    expect(
      await screen.findByPlaceholderText("Operations we have run, in our own words."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Footer/i })).not.toBeInTheDocument();
  });
});
