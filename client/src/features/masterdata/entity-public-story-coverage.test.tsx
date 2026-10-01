/**
 * 17 Sep review, M4-B6 — the first "where it operates" input lost focus after
 * every keystroke.
 *
 * The rows were keyed on `${country_code}-${index}`, and the first input in a
 * row edits `country_code`: type "C", the key changes, React unmounts the row
 * and mounts a new one, and the caret is gone. Typing "CM" took two clicks.
 * The rows now carry a local id that never changes while they are on screen,
 * so the assertion here is the simplest possible one — type two characters
 * into the fresh row and both land, with the input still focused.
 *
 * The second test pins the reason the id is not just the index: removing a
 * middle row must leave the rows below it intact rather than shifting their
 * keys onto the wrong DOM.
 *
 * Meeting 6 (29 Sep 2026), register 3.5 — the free two-letter box is now the
 * ISO country picker (Gabon had been saved as GB), an incomplete row blocks
 * the save with a message instead of being dropped, and a stored row whose
 * label names a place in another country is flagged.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

const puts: { path: string; body?: unknown }[] = [];
vi.mock("@/lib/api-client", async () => {
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method === "PUT") {
        puts.push({ path, body: init.body });
        return Promise.resolve({});
      }
      return base.tenant(path);
    },
  };
});
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { EntityDossier } from "./entity-360";
import { coverage } from "@shared";

type Row = { country_code: string; label_fr?: string; label_en?: string };
const story = (public_coverage: Row[] = []) => ({
  entity_id: "e1",
  code: "SLAS",
  legal_name: "Smart Logistics & Services Ltd",
  trading_name: null,
  country_code: "CM",
  registration_status: "ACTIVE",
  public_enabled: true,
  public_summary_fr: "Un réseau logistique.",
  public_summary_en: "A logistics network.",
  public_coverage,
  // What the API computes on read (site_settings.service getEntityStory).
  coverage_flags: coverage.flags(public_coverage),
  public_focus: [],
  public_cover_vault_id: null,
  cover_attachment: null,
});

const dossier = {
  entity: {
    entity_id: "e1",
    code: "SLAS",
    legal_name: "Smart Logistics & Services Ltd",
    country_code: "CM",
    registration_status: "ACTIVE",
    is_active: true,
    default_currency: "XAF",
  },
  structure: {
    parent_entity_id: null,
    relationship_type: null,
    ownership_percent: null,
    consolidates: false,
    is_group_parent: true,
    ancestors: [],
    children: [],
  },
  people: [],
  contacts: [],
  addresses: [],
  registrations: [],
  establishments: [],
  documents: [],
  tax_registrations: [],
  tax_obligations: [],
  treasury_accounts: [],
  treasury_is_read_only: true,
  cap_table: {
    as_of: "2026-09-19",
    holder_count: 0,
    total_percent: 0,
    total_shares: 0,
    issued_capital: 0,
    balanced: true,
    findings: [],
  },
  usage: { journal_entries: 0, employees: 0, treasury_accounts: 0, subsidiaries: 0 },
  readiness: { ready: true, missing: [] },
  expiring_registrations: [],
  can_see_governance: true,
  capabilities: { view: true, edit: true, approve: false, public_story: true },
  letterhead_config: null,
  letterhead_source: {},
  letterhead_preview: {
    language: "fr",
    paper_size: "A4",
    logo_position: "LEFT",
    header: {},
    footer: {},
    payment_block: { source: "none", accounts: [] },
    identifiers: [],
    empty_blocks: [],
  },
  renewals: {
    as_of: "2026-09-19",
    items: [],
    counts: { expired: 0, due: 0, approaching: 0 },
  },
};

async function openStoryTab(public_coverage: Row[] = []) {
  puts.length = 0;
  const user = userEvent.setup();
  renderScreen(<EntityDossier entityId="e1" onEdit={() => {}} />, {
    routes: {
      "/entities/e1/360": dossier,
      "/site-settings/entities/e1/story": story(public_coverage),
      "/site-settings/service-types": [],
    },
  });
  await user.click(await screen.findByRole("button", { name: /^public story$/i }));
  await screen.findByRole("button", { name: /add a place/i });
  return user;
}

describe("Corporate entities · Public story — where it operates", () => {
  it("keeps focus in a new place's label across keystrokes", async () => {
    const user = await openStoryTab();

    await user.click(screen.getByRole("button", { name: /add a place/i }));
    const label = screen.getByRole("textbox", { name: /label \(fr\)/i });
    await user.click(label);
    await user.keyboard("Douala");

    // Every character landed in the SAME element, and it is still the active
    // element — a remounted row would have swallowed the rest.
    expect(label).toHaveValue("Douala");
    expect(document.activeElement).toBe(label);
  });

  it("takes the country from the ISO picker, not a free box", async () => {
    const user = await openStoryTab();
    await user.click(screen.getByRole("button", { name: /add a place/i }));

    expect(screen.queryByRole("textbox", { name: /country code/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Country" }));
    await user.type(screen.getByRole("textbox", { name: "Search countries" }), "Gabon");
    await user.click(await screen.findByRole("option", { name: /Gabon/ }));
    await user.type(screen.getByRole("textbox", { name: /label \(fr\)/i }), "Libreville");
    await user.click(screen.getByRole("button", { name: /save places/i }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual({
      public_coverage: [{ country_code: "GA", label_fr: "Libreville", label_en: "" }],
    });
  });

  it("an incomplete row blocks the save with a message, and is not dropped", async () => {
    const user = await openStoryTab([{ country_code: "CM", label_fr: "Douala", label_en: "Douala" }]);
    await user.click(screen.getByRole("button", { name: /add a place/i }));
    await user.type(screen.getAllByRole("textbox", { name: /label \(en\)/i })[1], "Port-Gentil");
    await user.click(screen.getByRole("button", { name: /save places/i }));

    expect(await screen.findByText(/one place is incomplete/i)).toBeInTheDocument();
    expect(screen.getByText("Pick the country.")).toBeInTheDocument();
    expect(puts).toHaveLength(0);
    // Still on screen, label intact.
    expect(screen.getAllByRole("textbox", { name: /label \(en\)/i })[1]).toHaveValue("Port-Gentil");
  });

  it("flags a stored GB row whose label is Libreville, without changing it", async () => {
    await openStoryTab([
      { country_code: "CM", label_fr: "Douala", label_en: "Douala" },
      { country_code: "GB", label_fr: "Libreville", label_en: "Libreville" },
    ]);
    expect(screen.getByText("Check these places")).toBeInTheDocument();
    expect(
      screen.getByText('"Libreville" is in Gabon, but this row says United Kingdom (GB).'),
    ).toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });

  it("removes the row that was asked for, and only that one", async () => {
    const user = await openStoryTab([
      { country_code: "CM", label_fr: "Douala", label_en: "Douala" },
      { country_code: "GA", label_fr: "Libreville", label_en: "Libreville" },
      { country_code: "TD", label_fr: "N'Djamena", label_en: "N'Djamena" },
    ]);

    const rows = () =>
      screen
        .getAllByRole("textbox", { name: /label \(fr\)/i })
        .map((el) => (el as HTMLInputElement).value);
    expect(rows()).toEqual(["Douala", "Libreville", "N'Djamena"]);

    const middle = screen.getAllByRole("listitem")[1];
    await user.click(within(middle).getByRole("button", { name: /remove/i }));

    expect(rows()).toEqual(["Douala", "N'Djamena"]);
    // The row that stayed still holds ITS labels, not the removed row's.
    expect(screen.getAllByRole("textbox", { name: /label \(en\)/i })[1]).toHaveValue(
      "N'Djamena",
    );
  });
});
