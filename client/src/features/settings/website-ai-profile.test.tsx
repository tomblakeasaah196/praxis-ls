import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/**
 * Settings › Website › AI Profile.
 *
 * Pinned: the screen shows the row it loaded, a save sends ONLY what the
 * operator changed (the AI manifest writes the same row, so a full-form PUT
 * would put back whatever the assistant changed since the screen loaded), and a
 * reader without MOD-29 `edit` is offered no save at all.
 */

type Row = Record<string, unknown>;

const ROW: Row = {
  summary: "Freight forwarder and customs broker in Douala.",
  alternate_names: ["Acme Logistics", "Acme"],
  founded: "2009",
  offices: "Douala, Yaoundé",
  services_summary: "Sea and air freight, customs clearance.",
  sectors: ["Mining", "Energy"],
  areas_served: ["Cameroon", "Chad"],
  credentials: "FIATA member.",
  leadership: null,
  not_offered: "No passenger travel.",
  contact: "info@example.test",
  reviewed_on: "2026-07-03",
  updated_at: "2026-11-20T10:00:00Z",
  updated_by: null,
};

let existing: Row | null = null;
const puts: Row[] = [];
let mayEdit = true;

vi.mock("@/lib/api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ...actual,
    tenant: vi.fn(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path === "/site-settings/ai-profile" && !opts?.method) return existing;
      if (path === "/site-settings/ai-profile" && opts?.method === "PUT") {
        puts.push(opts.body as Row);
        existing = { ...(existing || {}), ...(opts.body as Row) };
        return existing;
      }
      return null;
    }),
  };
});

vi.mock("@/lib/route-access", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/route-access")>("@/lib/route-access");
  return {
    ...actual,
    useCan: () => (action: string) => (action === "view" ? true : mayEdit),
  };
});

import { WebsiteAiProfilePage } from "./website-ai-profile";

beforeEach(() => {
  existing = { ...ROW };
  puts.length = 0;
  mayEdit = true;
});

const mount = () =>
  render(
    <MemoryRouter>
      <WebsiteAiProfilePage />
    </MemoryRouter>,
  );

describe("the AI profile screen", () => {
  it("shows the profile it loaded, lists one per line and the date day-first", async () => {
    mount();
    expect(
      await screen.findByDisplayValue("Freight forwarder and customs broker in Douala."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Other Names")).toHaveValue("Acme Logistics\nAcme");
    expect(screen.getByLabelText("Areas Served")).toHaveValue("Cameroon\nChad");
    expect(screen.getByLabelText("Founded")).toHaveValue("2009");
    expect(screen.getByDisplayValue("03/07/2026")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("says Not Published when the saved summary is empty", async () => {
    existing = { ...ROW, summary: null };
    mount();
    expect(await screen.findByText("Not Published")).toBeInTheDocument();
  });

  it("sends only the fields that changed", async () => {
    mount();
    const founded = await screen.findByLabelText("Founded");
    await userEvent.clear(founded);
    await userEvent.type(founded, "2010");
    const sectors = screen.getByLabelText("Sectors");
    await userEvent.type(sectors, "\nAgriculture");

    await userEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      founded: "2010",
      sectors: ["Mining", "Energy", "Agriculture"],
    });
    expect(await screen.findByText(/Saved\./)).toBeInTheDocument();
  });

  it("does not count retyped whitespace as a change", async () => {
    mount();
    const founded = await screen.findByLabelText("Founded");
    await userEvent.type(founded, "  ");
    expect(screen.getByRole("button", { name: "Save Profile" })).toBeDisabled();
  });

  it("offers a viewer no save, and every field is read-only", async () => {
    mayEdit = false;
    mount();
    await screen.findByDisplayValue("Freight forwarder and customs broker in Douala.");
    expect(screen.queryByRole("button", { name: "Save Profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard Changes" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Summary")).toBeDisabled();
    expect(puts).toHaveLength(0);
  });
});
