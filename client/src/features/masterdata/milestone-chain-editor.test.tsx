/**
 * The milestone chain editor, after the meeting-7 review.
 *
 * ── WHAT THESE PIN, AND WHY A TEST RATHER THAN A LOOK ──────────────────────
 *
 * Three of the four things the owner asked for on 1 Oct 2026 are LAYOUT, and
 * layout is exactly what regresses silently: a field moved back behind an
 * expander still renders, still saves, and still passes tsc and every other gate.
 * The owner found the English label missing live in front of the tenant
 * (01:38:25: "It doesn't give you the possibility of changing the English name …
 * it's a gap in the UI"), which is the most expensive possible way to find it.
 *
 *   · BOTH labels are reachable without opening a row (3.2).
 *   · The owner dropdown offers the tenant's REGISTRY, not five hardcoded values,
 *     and the configuration button that edits it is on the screen (3.4).
 *   · A stage's weight is shown in days as well as percent, so repartitioning
 *     after a delete is not mental arithmetic (3.9).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";
import type { MilestoneStage, MilestoneOwner, ServiceType } from "@/lib/operations-api";

const milestoneSystemDefault = vi.fn();
const listAllMilestoneOwners = vi.fn();
const publishMilestoneTemplate = vi.fn();
const createMilestoneOwner = vi.fn();

vi.mock("@/lib/operations-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/operations-api")>("@/lib/operations-api");
  return {
    ...actual,
    milestoneSystemDefault: (...a: unknown[]) => milestoneSystemDefault(...a),
    listAllMilestoneOwners: (...a: unknown[]) => listAllMilestoneOwners(...a),
    publishMilestoneTemplate: (...a: unknown[]) => publishMilestoneTemplate(...a),
    createMilestoneOwner: (...a: unknown[]) => createMilestoneOwner(...a),
    updateMilestoneOwner: vi.fn(),
    deleteMilestoneOwner: vi.fn(),
  };
});

import { TemplateForm } from "./service-type-template-form";

/** PROJECT_CARGO as seed 9091 and 90998 leave it — the chain the meeting reviewed. */
const SVC: ServiceType = {
  service_type_id: "st-1",
  key: "PROJECT_CARGO",
  name_fr: "Cargaison Spéciale",
  name_en: "Project cargo",
  default_duration_days: 45,
  duration_basis: "WORKING_DAYS",
};

const stage = (over: Partial<MilestoneStage> & { code: string }): MilestoneStage => ({
  label_fr: "Étape",
  label_en: "Stage",
  weight: 0,
  min_duration_hours: 8,
  owner_tier: "INTERNAL",
  chain_segment: "MAIN",
  is_target_lock: false,
  ...over,
});

const SHIPPED: MilestoneStage[] = [
  stage({
    code: "FEASIBILITY",
    label_fr: "Étude de faisabilité et reconnaissance",
    label_en: "Feasibility & route survey",
    weight: 20,
  }),
  stage({
    code: "PERMITS",
    label_fr: "Autorisations convoi exceptionnel et escortes",
    label_en: "Abnormal-load permits & escorts",
    weight: 40,
    owner_tier: "ROAD_AUTHORITY",
  }),
  stage({
    code: "SITE_DELIVERY",
    label_fr: "Livraison et déchargement sur site",
    label_en: "Delivery & offloading at site",
    weight: 40,
    is_target_lock: true,
  }),
];

/** The registry 90998 seeds, trimmed to what these assertions need. */
const OWNERS: MilestoneOwner[] = [
  { owner_id: "o1", code: "INTERNAL", name: "Internal ops", name_fr: "Opérations internes", is_internal: true, is_system: true, sort_order: 10 },
  { owner_id: "o2", code: "CUSTOMS", name: "Customs", name_fr: "Douane", is_internal: false, is_system: true, sort_order: 51 },
  { owner_id: "o3", code: "ROAD_AUTHORITY", name: "Road authority", name_fr: "Autorité routière", is_internal: false, is_system: true, sort_order: 52 },
  { owner_id: "o4", code: "SURVEYOR", name: "Surveyor / inspector", name_fr: "Expert / inspecteur", is_internal: false, is_system: true, sort_order: 60 },
];

const view = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } })}
    >
      <ToastProvider>
        <TemplateForm svc={SVC} initial={SHIPPED} onClose={() => {}} onSaved={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  for (const m of [
    milestoneSystemDefault,
    listAllMilestoneOwners,
    publishMilestoneTemplate,
    createMilestoneOwner,
  ])
    m.mockReset();
  milestoneSystemDefault.mockResolvedValue(SHIPPED);
  listAllMilestoneOwners.mockResolvedValue(OWNERS);
  publishMilestoneTemplate.mockResolvedValue([]);
});

describe("the chain editor · both names on the row (finding 3.2)", () => {
  it("puts the English label beside the French one, with no row expanded", async () => {
    view();
    // The exact gap the owner found: the French field was there and the English
    // one was not. Both are addressable by their own accessible name, and
    // nothing has been clicked.
    expect(
      await screen.findByLabelText("Stage 1 label (French)"),
    ).toHaveValue("Étude de faisabilité et reconnaissance");
    expect(screen.getByLabelText("Stage 1 label (English)")).toHaveValue(
      "Feasibility & route survey",
    );
    for (let i = 1; i <= 3; i += 1) {
      expect(screen.getByLabelText(`Stage ${i} label (English)`)).toBeInTheDocument();
    }
  });

  it("the English label is no longer DUPLICATED inside the expander", async () => {
    const user = userEvent.setup();
    view();
    await user.click(
      await screen.findByRole("button", { name: /Show details for FEASIBILITY/i }),
    );
    // Moving a field has to mean moving it. Two inputs bound to the same state
    // is its own bug — the second reads stale the moment you type in the first.
    expect(screen.getAllByLabelText("Stage 1 label (English)")).toHaveLength(1);
    // The fields that genuinely belong in the expander are still there.
    expect(screen.getByLabelText(/Minimum duration/i)).toBeInTheDocument();
  });

  it("sends an edited English label through to publish", async () => {
    const user = userEvent.setup();
    view();
    const en = await screen.findByLabelText("Stage 1 label (English)");
    await user.clear(en);
    await user.type(en, "Feasibility study");
    await user.click(screen.getByRole("button", { name: "Publish new version" }));
    await waitFor(() => expect(publishMilestoneTemplate).toHaveBeenCalled());
    const body = publishMilestoneTemplate.mock.calls[0][0] as {
      stages: MilestoneStage[];
    };
    expect(body.stages[0].label_en).toBe("Feasibility study");
    // And the French one is untouched — editing one name must not clear the other.
    expect(body.stages[0].label_fr).toBe("Étude de faisabilité et reconnaissance");
  });
});

describe("the chain editor · owners come from the registry (finding 3.4)", () => {
  it("offers the tenant's rows, including ones the old enum never had", async () => {
    view();
    const select = await screen.findByLabelText("Stage 2 owner");
    // The select renders before the registry fetch resolves, so this awaits the
    // options rather than reading them on the first paint.
    await waitFor(() =>
      expect(within(select).getByRole("option", { name: "Internal ops" })).toBeInTheDocument(),
    );
    // Labels, never the SCREAMING_CODE (FRONTEND_GUIDE §5).
    for (const label of ["Internal ops", "Customs", "Road authority", "Surveyor / inspector"]) {
      expect(within(select).getByRole("option", { name: label })).toBeInTheDocument();
    }
    // The stage seeded as ROAD_AUTHORITY — a value the hardcoded five could not
    // express — is the one selected.
    expect(select).toHaveValue("ROAD_AUTHORITY");
  });

  it("keeps a stage's stored owner selectable after it is deactivated", async () => {
    // Otherwise editing the WEIGHT of a stage silently reassigns its owner to
    // whatever the first option happens to be.
    // Switched OFF, not deleted — the row is still in the registry, so its NAME
    // is still known. That is the whole reason the hook fetches every row.
    listAllMilestoneOwners.mockResolvedValue(
      OWNERS.map((o) => (o.code === "ROAD_AUTHORITY" ? { ...o, is_active: false } : o)),
    );
    view();
    const select = await screen.findByLabelText("Stage 2 owner");
    await waitFor(() =>
      expect(within(select).getByRole("option", { name: /Road authority \(retired\)/i })).toBeInTheDocument(),
    );
    expect(select).toHaveValue("ROAD_AUTHORITY");
  });

  it("offers the configuration button the meeting asked for, and it opens the registry", async () => {
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole("button", { name: /Milestone owners/i }));
    // The dialog, not a navigation away from a half-edited chain.
    expect(await screen.findByText(/The code is permanent/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add owner" })).toBeInTheDocument();
    await waitFor(() => expect(listAllMilestoneOwners).toHaveBeenCalled());
  });
});

describe("the chain editor · a weight in days (finding 3.9)", () => {
  it("shows what each weight means against the service's horizon", async () => {
    view();
    // 20% of 45 working days ≈ 9; 40% ≈ 18. Approximate on purpose — the real
    // dates come off the working calendar and the per-stage floors.
    expect(await screen.findByText("≈9")).toBeInTheDocument();
    expect(screen.getAllByText("≈18")).toHaveLength(2);
    expect(screen.getByText(/over 45 days/i)).toBeInTheDocument();
  });

  it("recomputes as a weight is repartitioned", async () => {
    const user = userEvent.setup();
    view();
    const w = await screen.findByLabelText("Stage 1 weight");
    await user.clear(w);
    await user.type(w, "60");
    expect(await screen.findByText("≈27")).toBeInTheDocument();
  });

  it("says nothing when the service has no horizon to divide", async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } })}
      >
        <ToastProvider>
          <TemplateForm
            svc={{ ...SVC, default_duration_days: null }}
            initial={SHIPPED}
            onClose={() => {}}
            onSaved={() => {}}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByLabelText("Stage 1 weight")).toBeInTheDocument();
    // An invented number is worse than none.
    expect(screen.queryByText(/^≈/)).not.toBeInTheDocument();
    expect(screen.queryByText(/over .* days/i)).not.toBeInTheDocument();
  });
});
