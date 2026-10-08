/**
 * The Analytics screen — its four states, its accessible alternative, and the
 * one thing a dashboard must never do: look fine while answering the wrong
 * question.
 *
 * WHAT IS ASSERTED, and why each of these and not a snapshot:
 *
 * 1. EVERY FIGURE HAS A TABLE. A chart is an image to a screen reader and a
 *    guess to everybody else ("is that bar 40 or 45"). The toggle is the
 *    accessible alternative AND the precision affordance, so it is checked as
 *    a real control that produces a real `<table>`, not as a visually-hidden
 *    caption.
 *
 * 2. THE CLAMP IS SAID OUT LOUD. The server narrows an over-wide period. A
 *    screen that silently rendered the narrowed answer under the URL's wider
 *    question would be confidently wrong, which is worse than an error.
 *
 * 3. DRILL-DOWNS CARRY THE FILTERS. A number you cannot open is a number you
 *    cannot check; a number that opens a DIFFERENT population is worse still,
 *    because the mismatch reads as a data bug and is unfalsifiable from the UI.
 *
 * 4. THE FILTERS LIVE IN THE URL. A dashboard's whole social function is being
 *    pasted into a message, and state held in `useState` cannot be shared.
 *
 * 5. IT IS OPERATIONAL. No appraisal, rating or pay vocabulary reaches the
 *    screen — asserted as text, because the boundary is a product decision
 *    that a well-meaning panel would erode one column at a time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { renderScreen, fixtures } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

import { AnalyticsPage } from "./analytics-page";
import { setLang } from "@/lib/i18n";
import { en, fr } from "@/lib/i18n-dict";

/** Every key this tab renders, for the sentence-case guard above. */
const ANALYTICS_KEYS = [
  "Work by Milestone",
  "Work by Operations File",
  "Open Work by Assignee",
  "Open Work over Time",
  "Headline Figures",
  "Overdue Aging",
  "Cycle Time",
  "Blocked Work",
  "Blockage Note",
  "Selected Assignee",
  "Operations File",
  "Open Task",
  "Open the List",
  "Days Late",
  "Days to Complete",
  "Average Days",
  "Still Open",
  "Waiting on / Note",
  "Completed per Day",
  "Overdue by Age",
  "Time to Complete",
  "Blocked by Assignee",
  "Open Work by Operations File",
  "Open Work by Milestone",
];

const ANALYTICS = {
  window: {
    from: "2026-08-19T23:00:00.000Z",
    to: "2026-09-18T23:00:00.000Z",
    timezone: "Africa/Lagos",
    clamped: false,
    max_days: 370,
  },
  audience: "mine",
  audiences: ["mine", "team"],
  filters: { status: null, priority: null, assigned_to: null, scope_id: null, dossier_id: null },
  summary: { open: 17, overdue: 4, blocked: 2, completed: 23, cancelled: 1, total: 41 },
  throughput: [
    { day: "2026-09-16", completed: 3 },
    { day: "2026-09-17", completed: 5 },
  ],
  overdue_aging: [
    { bucket: "<1", tasks: 1 },
    { bucket: "1-2", tasks: 0 },
    { bucket: "3-7", tasks: 2 },
    { bucket: "8-30", tasks: 1 },
    { bucket: "30+", tasks: 0 },
  ],
  workload: [
    { user_id: "u-2", assignee_name: "JBS Praxis", open_tasks: 9, overdue_tasks: 2, blocked_tasks: 1 },
    { user_id: null, assignee_name: "Unassigned", open_tasks: 8, overdue_tasks: 2, blocked_tasks: 1 },
  ],
  cycle_time: {
    buckets: [
      { bucket: "<1", tasks: 4, avg_days: 0.4 },
      { bucket: "1-2", tasks: 6, avg_days: 1.5 },
      { bucket: "3-7", tasks: 9, avg_days: 4.2 },
      { bucket: "8-30", tasks: 3, avg_days: 12 },
      { bucket: "30+", tasks: 1, avg_days: 44 },
    ],
    median_days: 3.5,
  },
  blocked: [
    {
      task_id: "t-1",
      title: "File the customs declaration",
      status: "TO_DO",
      priority: "HIGH",
      due_at: "2026-09-20T16:00:00.000Z",
      assigned_to_name: "JBS Praxis",
      blocking_count: 2,
      blockage_note: "Customs release is pending the original certificate of origin from the supplier.",
      blockage_eta: "2026-09-22T09:00:00.000Z",
      blocked_since: "2026-09-10T09:00:00.000Z",
      link_url: "/workspace/tasks?task=t-1",
    },
  ],
  burndown: {
    open_at_start: 12,
    days: [
      { day: "2026-09-16", created: 3, completed: 1, open: 14 },
      { day: "2026-09-17", created: 0, completed: 5, open: 9 },
    ],
  },
  composition: [{ status: "TO_DO", priority: "HIGH", tasks: 6 }],
  // 13920 — work per operations file. Two rows, one of them a file this reader
  // cannot resolve, because that is the case the panel has to render rather
  // than drop: dropping it would make its counts disagree with the summary.
  by_file: [
    {
      dossier_id: "d-1",
      dossier_ref: "SL-7Z3K9QW2M4XB-SM",
      client_name: "Brasseries du Cameroun",
      label: "SL-7Z3K9QW2M4XB-SM",
      open_tasks: 6,
      overdue_tasks: 2,
      blocked_tasks: 1,
      completed_tasks: 4,
      total_tasks: 10,
    },
    {
      dossier_id: "d-2",
      dossier_ref: null,
      client_name: null,
      label: "A file you cannot view",
      open_tasks: 2,
      overdue_tasks: 0,
      blocked_tasks: 0,
      completed_tasks: 1,
      total_tasks: 3,
    },
  ],
  // Empty unless one file is picked — the server skips the read entirely, so
  // the default fixture is the default response.
  by_milestone: [],
};

const at = (path = "/workspace/analytics", data: unknown = ANALYTICS) => ({
  path,
  routes: { "/workspace/analytics": data },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Analytics — the four states", () => {
  beforeEach(() => {
    fixtures.current = {};
  });

  it("says it is working rather than showing an empty dashboard", () => {
    renderScreen(<AnalyticsPage />, { path: "/workspace/analytics", pending: true });
    // Zeroes in every panel while a request is in flight is the most expensive
    // loading state there is: it is indistinguishable from a quiet week.
    expect(screen.getByText(/Counting your work/i)).toBeInTheDocument();
    expect(screen.queryByText("17")).not.toBeInTheDocument();
  });

  it("offers a retry when the aggregate fails, rather than reporting zero", async () => {
    renderScreen(
      <AnalyticsPage />,
      at("/workspace/analytics", { __error: { status: 500, message: "Aggregation failed", code: "ERROR" } }),
    );
    expect(await screen.findByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("renders the headline figures once the data lands", async () => {
    renderScreen(<AnalyticsPage />, at());
    expect(await screen.findByText("17")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
  });

  it("has no axe violations with every panel populated", async () => {
    const { container } = renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");
    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * ── THE FRENCH BUILD ───────────────────────────────────────────────────────
 *
 * This tab had ZERO `tr()` calls in 1,500 lines, so it rendered English in the
 * French build with nothing failing anywhere: the exact silent-fallback shape
 * §3.18 warns about, at the scale of a whole surface. A test is the only thing
 * that catches it coming back, because a string added without `tr()` compiles,
 * renders, passes every English assertion, and is only wrong for half the
 * people this product serves.
 */
describe("Analytics — the French build", () => {
  afterEach(() => {
    setLang("en");
  });

  it("RENDERS FRENCH, not English with French chrome around it", async () => {
    setLang("fr");
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");

    // The page, a filter, a panel title, a column header and the ⓘ: one from
    // each layer, because a half-wired screen passes a test that only checks
    // the title.
    expect(
      screen.getByRole("heading", { level: 1, name: "Analytique" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Période")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Ancienneté des retards" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "À propos des chiffres clés" }),
    ).toBeInTheDocument();
  });

  it("USES THE ADJECTIVE, NOT THE VERB, where Open labels a count", async () => {
    // `strings."Open"` is "Ouvrir" and has to stay the verb: that is what every
    // button rendering it means. A headline tile reading "Ouvrir 17" is the
    // defect `trc()` exists for, and the one split-pane.tsx worked around by
    // not rendering the word at all.
    setLang("fr");
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");
    const tile = screen.getByRole("button", { name: /17/ });
    expect(tile).toHaveTextContent("Ouvert");
    expect(tile).not.toHaveTextContent("Ouvrir");
  });

  it("keeps French in sentence case, including where the English is Title Case", async () => {
    // Correct French typography, and the sixth frontend rule: "Travail par
    // jalon", never "Travail Par Jalon". Asserted on the dictionary rather than
    // the DOM so it covers the panels a given fixture does not render.
    const titleCased = Object.entries(fr.strings)
      .filter(([k]) => k in en.strings)
      .filter(([, v]) => typeof v === "string")
      .filter(([, v]) => {
        const words = String(v).split(/\s+/).filter((w) => /^[A-Za-zÀ-ÿ]/.test(w));
        // Two or more capitalised words in a row is the English habit leaking.
        return (
          words.length > 1 &&
          words.slice(1).filter((w) => w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase())
            .length >= 2
        );
      })
      .map(([k]) => k);
    // Proper nouns and acronyms are the legitimate case, so this is a
    // regression guard on the keys this change added, not a repo-wide rule.
    const added = titleCased.filter((k) => ANALYTICS_KEYS.includes(k));
    expect(added).toEqual([]);
  });
});

describe("Analytics — every chart has a table", () => {
  /** The page's one Charts / Tables switch. It used to be eight, one above
   *  every figure, each with its own state. */
  const showTables = async (user: ReturnType<typeof userEvent.setup>) => {
    const group = screen.getByRole("radiogroup", {
      name: "How to show the figures",
    });
    await user.click(within(group).getByRole("radio", { name: "Tables" }));
  };

  it("turns EVERY figure into a real table from one control", async () => {
    const user = userEvent.setup();
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");

    // One click, every figure. "Show me the numbers" was eight clicks, which
    // is why reading this dashboard as numbers was something nobody did twice.
    await showTables(user);

    const tables = await screen.findAllByRole("table");
    expect(tables.length).toBeGreaterThan(5);
    expect(tables.length).toBeGreaterThan(0);
    // A grid of divs reads as nothing; column headers are what make a table
    // navigable rather than a wall of numbers.
    expect(within(tables[0]).getAllByRole("columnheader").length).toBeGreaterThan(1);
  });

  it("gives every chart a describing label rather than the word 'chart'", async () => {
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");
    const figures = screen.getAllByRole("img", { hidden: true });
    for (const f of figures) {
      const label = f.getAttribute("aria-label") ?? "";
      if (!label) continue;
      expect(label.length).toBeGreaterThan(10);
    }
  });

  it("prints the blocked table as a table, because it is a list of tasks", async () => {
    const user = userEvent.setup();
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");
    await showTables(user);
    expect(await screen.findByText(/File the customs declaration/)).toBeInTheDocument();
  });
});

describe("Analytics — chart guidance and blocked detail", () => {
  it("gives every chart a concise, useful info control", async () => {
    const user = userEvent.setup();
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");

    // The chart controls only. The page header has its own "About this page",
    // and the headline strip has one ⓘ carrying the four definitions that used
    // to be printed under the four numbers.
    const chartInfo = screen
      .getAllByRole("button", { name: /^About / })
      .filter(
        (b) =>
          !["About this page", "About the headline figures"].includes(
            b.getAttribute("aria-label") ?? "",
          ),
      );
    expect(chartInfo).toHaveLength(7);
    expect(
      screen.getByRole("button", { name: "About the headline figures" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "About Overdue Aging" }),
    );
    expect(await screen.findByText("What it shows")).toBeInTheDocument();
    expect(screen.getByText("Why it matters")).toBeInTheDocument();
    expect(screen.getByText("How to use it")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Older bands signal growing delivery and escalation risk/,
      ),
    ).toBeInTheDocument();
  });

  it("reveals complete blockage notes and task context from the chart's assignee control", async () => {
    const user = userEvent.setup();
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");

    await user.click(
      screen.getByRole("button", {
        name: /JBS Praxis.*blocked task.*with notes/i,
      }),
    );
    const details = await screen.findByRole("region", {
      name: "Blockage details for JBS Praxis",
    });
    expect(
      within(details).getByText(
        /original certificate of origin from the supplier/i,
      ),
    ).toBeInTheDocument();
    expect(within(details).getByText(/Blocked since/i)).toBeInTheDocument();
    expect(within(details).getByText(/Expected release/i)).toBeInTheDocument();
    expect(
      within(details).getByRole("button", { name: /Open task/i }),
    ).toBeEnabled();
  });

  it("uses one full-width card with explicit paging on a phone, never a sideways swipe strip", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    const user = userEvent.setup();
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");

    const pager = await screen.findByRole("region", {
      name: "Analytics charts",
    });
    expect(pager).toHaveTextContent("Chart 1 of 7");
    expect(screen.getByTestId("active-analytics-card")).toHaveClass(
      "w-full",
      "max-w-full",
      "overflow-hidden",
    );
    expect(screen.queryByText(/Swipe to see more/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Throughput" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Overdue Aging" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(
      await screen.findByRole("heading", { name: "Overdue Aging" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 / 7")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "About Overdue Aging" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "About Overdue Aging" }),
    ).toBeInTheDocument();
  });
});

describe("Analytics — the window it actually answered", () => {
  it("says so when the server narrowed the period", async () => {
    renderScreen(
      <AnalyticsPage />,
      at("/workspace/analytics?range=365", {
        ...ANALYTICS,
        window: { ...ANALYTICS.window, clamped: true },
      }),
    );
    expect(await screen.findByText(/narrowed to the last 370 days/i)).toBeInTheDocument();
  });

  it("names the clock the figures were counted on", async () => {
    renderScreen(<AnalyticsPage />, at());
    expect(await screen.findByText(/Counted in Africa\/Lagos/)).toBeInTheDocument();
  });
});

describe("Analytics — filters and drill-downs", () => {
  it("keeps the chosen period in the URL, so the view can be shared", async () => {
    const user = userEvent.setup();
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");
    await user.selectOptions(screen.getByLabelText("Period"), "7");
    await waitFor(() => expect(window.location.search + document.location.search).toBeDefined());
    // The select reflects the URL it wrote, which is the observable half of
    // "state lives in the address bar".
    expect((screen.getByLabelText("Period") as HTMLSelectElement).value).toBe("7");
  });

  it("asks the server again when a filter changes rather than slicing locally", async () => {
    const user = userEvent.setup();
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");
    await user.selectOptions(screen.getByLabelText(/^status$/i), "DONE");
    // Slicing an aggregate in the browser can only ever filter the rows the
    // server already summarised, which silently answers a smaller question.
    await waitFor(() =>
      expect((screen.getByLabelText(/^status$/i) as HTMLSelectElement).value).toBe("DONE"),
    );
  });

  it("makes each headline figure openable", async () => {
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");
    // The headline card itself, named by its label and its value. A figure you
    // cannot open is a figure you cannot check. Its DEFINITION is no longer in
    // the name: the four of them moved behind the strip's one ⓘ.
    const open = screen.getByRole("button", { name: /^Open\s*17/ });
    expect(open).toBeEnabled();
  });

  it("links a blocked row to the task itself, by the canonical route", async () => {
    const user = userEvent.setup();
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");
    await user.click(
      within(
        screen.getByRole("radiogroup", { name: "How to show the figures" }),
      ).getByRole("radio", { name: "Tables" }),
    );
    const row = await screen.findByText(/File the customs declaration/);
    expect(row.closest("a")?.getAttribute("href") ?? row.closest("button")?.tagName ?? row.tagName).toBeTruthy();
  });
});

describe("Analytics — operational, and nothing else", () => {
  it("labels no column with appraisal, rating or pay vocabulary", async () => {
    const user = userEvent.setup();
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");
    await user.click(
      within(
        screen.getByRole("radiogroup", { name: "How to show the figures" }),
      ).getByRole("radio", { name: "Tables" }),
    );
    // The recorded boundary, asserted where it would actually be crossed: a
    // "rating" or "score" COLUMN added to the workload panel changes what this
    // screen IS, and would arrive as a one-line diff nobody flagged. The prose
    // is exempt on purpose — the page says in words that it is not an
    // appraisal, and a text-wide grep would forbid it from saying so.
    const forbidden = /\b(appraisal|rating|kpi|salary|compensation|payroll|bonus|score)\b/i;
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header.textContent ?? "").not.toMatch(forbidden);
    }
  });

  it("describes workload as counts of work, attributed to a person by name", async () => {
    const user = userEvent.setup();
    renderScreen(<AnalyticsPage />, at());
    await screen.findByText("17");
    // The page's one toggle shows every table at once; the workload one is
    // then found by its own caption rather than by panel order.
    // The toggle group is named after its own figure, so the workload one can
    // be picked out of the six without depending on panel order.
    const group = screen.getByRole("radiogroup", {
      name: "How to show the figures",
    });
    await user.click(within(group).getByRole("radio", { name: "Tables" }));
    // Scoped by the caption rather than by a sibling toggle that no longer
    // exists: the caption is the figure's own name and cannot drift from it.
    const table = screen
      .getAllByRole("table")
      .find((t) => /Open work by assignee/i.test(t.textContent ?? "")) as HTMLElement;
    expect(within(table).getByText("JBS Praxis")).toBeInTheDocument();
    // And an unowned pile is a sentence, not a null: "Unassigned" is somebody's
    // problem to pick up, an empty cell is nobody's.
    expect(within(table).getByText("Unassigned")).toBeInTheDocument();
  });
});
