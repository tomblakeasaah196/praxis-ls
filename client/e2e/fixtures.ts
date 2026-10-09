/**
 * A signed-in app with a faked API, for the desktop layout gate.
 *
 * WHY THIS IS MORE THAN "GOTO THE URL". `app-shell` only renders behind auth,
 * and the access token is in memory by design — only the refresh token is
 * persisted. So a browser run against the built `dist/` lands on the LANDING
 * PAGE unless the boot refresh is satisfied. Addendum 7 records exactly what
 * happens when it is not:
 *
 *   "the first run measured the landing page at four widths and reported one
 *    <h1> and no horizontal scroll, all of it true and all of it meaningless.
 *    A harness that renders the wrong screen still produces a confident table."
 *
 * Which is why `openScreen` below ASSERTS it arrived, and every spec asserts a
 * marker unique to the screen it thinks it is measuring.
 *
 * WHY THE API IS FAKED AND NOT RUN. A real API needs Postgres and Redis, which
 * turns a layout check into an integration environment. It would also make the
 * measurements depend on how much seed data a tenant happens to have — and a
 * gate whose numbers move when a fixture row is added is a gate that gets
 * ignored. Everything here is fixed, so a change in a measured number means a
 * change in the layout.
 */
import type { Page, Route } from "@playwright/test";

const USER = {
  user_id: "u-1",
  email: "ops@smartls.test",
  display_name: "Ops Lead",
  full_name: "Ops Lead",
  role: "ADMIN",
  avatar_url: null,
};

/** Enough rows to fill a table past one screen at 2560px. */
function accounts(n: number) {
  const CLASSES = [1, 2, 3, 4, 5, 6, 7];
  return Array.from({ length: n }, (_, i) => ({
    code: String(601000 + i * 100),
    parent_code: "601",
    label_fr: `Compte de charge numéro ${i + 1}`,
    label_en: `Expense account number ${i + 1}`,
    class: CLASSES[i % CLASSES.length],
    normal_balance: i % 2 ? "C" : "D",
    is_postable: i % 3 !== 0,
    requires_analytic: i % 5 === 0,
  }));
}

/** Enough conversations to overflow the list pane at 2560px. */
function threads(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    email_thread_id: `t-${i + 1}`,
    email_connection_id: "c-1",
    thread_key: `<root-${i + 1}>`,
    subject: `Demurrage on MSKU${1234567 + i}`,
    participants: [`ops${i}@maersk.cm`, "ops@smartls.test"],
    message_count: (i % 4) + 1,
    has_attachment: i % 3 === 0,
    stream: "HUMAN",
    stream_reason: null,
    is_vip: i % 7 === 0,
    entity_ref: null,
    entity_label: null,
    last_message_at: "2026-10-07T09:15:00.000Z",
    mailbox_address: "ops@smartls.test",
    unread_count: i % 2,
    is_starred: i % 5 === 0,
    preview: "Please confirm the charges before Friday so we can release it.",
    last_from: `ops${i}@maersk.cm`,
  }));
}

/**
 * path (after `/api`) → payload. Longest-prefix matched, as the vitest harness
 * does, so `/tenant/chart-of-accounts?limit=50` resolves from the bare key.
 */
/**
 * The navigation access the shell renders from.
 *
 * WITHOUT THIS THE GATE MEASURES THE WRONG SHELL. An unmocked read resolves to
 * `[]`, which the client coerces to "no access" — so the ribbon renders nothing
 * and every width below would be measured against an app with no navigation in
 * it. That is the Addendum 7 failure this file's own header describes, one level
 * down: a harness that renders the wrong screen still produces a confident
 * table.
 *
 * All six families, because a layout gate should measure the WIDEST chrome the
 * product can produce, not the narrowest. `byGroup` is the server's partition of
 * the visible modules — the client never invents it, so the fixture has to
 * carry it in the shape the endpoint returns.
 */
const NAV_ACCESS = (() => {
  const byGroup: Record<string, string[]> = {
    monitor: ["MOD-00A", "MOD-64", "MOD-74"],
    engage: [
      "MOD-20",
      "MOD-21",
      "MOD-23",
      "MOD-24",
      "MOD-27",
      "MOD-28",
      "MOD-60",
      "MOD-61",
      "MOD-62",
    ],
    fulfill: [
      "MOD-29",
      "MOD-30",
      "MOD-31",
      "MOD-32",
      "MOD-33",
      "MOD-34",
      "MOD-35",
      "MOD-36",
      "MOD-39",
      "MOD-41",
      "MOD-42",
    ],
    transact: [
      "MOD-46",
      "MOD-47",
      "MOD-49",
      "MOD-51",
      "MOD-52",
      "MOD-53",
      "MOD-54",
      "MOD-56",
      "MOD-58",
      "MOD-59",
    ],
    empower: ["MOD-02", "MOD-11", "MOD-12", "MOD-14", "MOD-15", "MOD-17"],
    configure: [
      "MOD-01",
      "MOD-03",
      "MOD-04",
      "MOD-05",
      "MOD-07",
      "MOD-08",
      "MOD-09",
      "MOD-10",
      "MOD-63",
      "MOD-65",
      "MOD-66",
      "MOD-67",
      "MOD-68",
      "MOD-70",
      "MOD-75",
    ],
  };
  return {
    modules: Object.values(byGroup).flat().sort(),
    groups: Object.keys(byGroup),
    byGroup,
    isCeo: false,
    version: "e2efixture01",
  };
})();

const ANALYTICS = {
  window: {
    from: "2026-08-21T00:00:00.000Z",
    to: "2026-09-21T00:00:00.000Z",
    timezone: "Africa/Lagos",
    clamped: false,
    max_days: 370,
  },
  audience: "mine",
  audiences: ["mine", "team"],
  filters: {
    status: null,
    priority: null,
    assigned_to: null,
    scope_id: null,
    dossier_id: null,
  },
  summary: {
    open: 17,
    overdue: 4,
    blocked: 2,
    completed: 23,
    cancelled: 1,
    total: 41,
  },
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
    {
      user_id: "u-1",
      assignee_name: "Ops Lead",
      open_tasks: 9,
      overdue_tasks: 2,
      blocked_tasks: 2,
    },
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
      task_id: "task-blocked-1",
      title: "File the customs declaration",
      status: "TO_DO",
      priority: "HIGH",
      due_at: "2026-09-20T16:00:00.000Z",
      assigned_to_name: "Ops Lead",
      blocking_count: 2,
      blockage_note:
        "Customs release is pending the original certificate of origin from the supplier.",
      blockage_eta: "2026-09-22T09:00:00.000Z",
      blocked_since: "2026-09-10T09:00:00.000Z",
      link_url: "/workspace/tasks?task=task-blocked-1",
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
  ],
  by_milestone: [],
};

const ROUTES: Record<string, unknown> = {
  "/tenant/auth/refresh": {
    access_token: "at",
    refresh_token: "rt",
    user: USER,
  },
  "/tenant/auth/me": USER,
  "/branding": { name: "Smart Logistics", theme: "light" },
  "/tenant/chart-of-accounts": accounts(60),
  "/tenant/notifications/unread-count": { count: 0 },
  "/tenant/comms/unread-count": { count: 0 },
  "/tenant/ai/status": { enabled: false },
  "/tenant/permissions/mine": NAV_ACCESS,
  "/tenant/documents": [
    {
      doc_id: "doc-long-reference",
      doc_type: "QUOTE_REQUEST_ATTACHMENT",
      status: "PENDING",
      entity_ref:
        "quote_request:7904cd9e-5df-40a8-b1a7-2f8e66dd9c77:attachment:commercial-proposal-final.pdf",
      original_name: "commercial-proposal-final.pdf",
      created_at: "2026-10-08T09:15:00.000Z",
    },
  ],
  "/tenant/compliance": [
    {
      flag_id: "flag-long-message",
      rule_key: "party.doc_missing",
      severity: "WARN",
      message:
        "Missing Attestation of Fiscal Compliance (Attestation de conformité fiscale) for the selected counterparty dossier.",
      created_at: "2026-10-08T09:10:00.000Z",
      resolved_at: null,
    },
  ],
  "/tenant/workspace/context": { timeZone: "Africa/Lagos" },
  "/tenant/workspace/analytics": ANALYTICS,
  /*
   * Pinned open (the default), and the rail's one-time hint already spent.
   * `railHintSeen: false` would leave a 240ms shake running while the first
   * measurements are taken, which is a gate whose numbers depend on when the
   * screenshot happened to land.
   */
  /*
   * THE MAILBOX. One connected mailbox (so the rail draws no picker), the two
   * stream totals, the canonical folders, and 40 conversations — enough to
   * overflow the list pane at every width the gate measures, which is the whole
   * point of `mail-workstation.spec.ts`.
   *
   * `/mail/threads/` is longer than `/mail/threads`, so `payloadFor`'s
   * longest-prefix match sends a single-thread read to the detail payload and
   * the list read to the list. That ordering is load-bearing: swap the two and
   * the reading pane renders a list.
   */
  "/tenant/mail/mailboxes/mine": [
    {
      email_connection_id: "c-1",
      email_address: "ops@smartls.test",
      status: "CONNECTED",
      is_primary: true,
      kind: "SHARED",
    },
  ],
  "/tenant/mail/folders": {
    folders: [
      { email_folder_id: "f-1", canonical: "INBOX", display_name: "Inbox", provider_path: "INBOX", unread_count: 12 },
      { email_folder_id: "f-2", canonical: "SENT", display_name: "Sent", provider_path: "Sent", unread_count: 0 },
      { email_folder_id: "f-3", canonical: "ARCHIVE", display_name: "Archive", provider_path: "Archive", unread_count: 0 },
      { email_folder_id: "f-4", canonical: "SPAM", display_name: "Spam", provider_path: "Spam", unread_count: 3 },
      { email_folder_id: "f-5", canonical: "TRASH", display_name: "Trash", provider_path: "Trash", unread_count: 0 },
    ],
    streams: { HUMAN: 12, SYSTEM: 31 },
  },
  "/tenant/mail/labels": [],
  /* The TRAILING SLASH is load-bearing. `payloadFor` matches the longest
     prefix, so this key answers every `/mail/threads/<id>` read while
     `/tenant/mail/threads` below answers the list. Without it a single-thread
     read falls through to the list payload, `getThread` receives an array, and
     the reading pane renders a conversation with no subject and no messages.
     Every row opens the SAME conversation, which is right for a gate that
     measures layout: the pane's geometry must not depend on which row was
     clicked. */
  "/tenant/mail/threads/": {
    email_thread_id: "t-1",
    email_connection_id: "c-1",
    thread_key: "<root-1>",
    subject: "Demurrage on MSKU1234567",
    participants: ["ops@maersk.cm", "ops@smartls.test"],
    message_count: 2,
    has_attachment: true,
    stream: "HUMAN",
    is_vip: true,
    entity_ref: null,
    entity_label: null,
    last_message_at: "2026-10-07T09:15:00.000Z",
    mailbox_address: "ops@smartls.test",
    unread_count: 0,
    is_starred: false,
    preview: "Please confirm the charges before Friday.",
    last_from: "ops@maersk.cm",
    messages: [
      {
        email_message_id: "m-1",
        direction: "IN",
        from_address: "ops@maersk.cm",
        from_name: "Maersk Ops",
        to_address: ["ops@smartls.test"],
        cc_address: [],
        folder: "INBOX",
        is_read: true,
        has_attachment: false,
        received_at: "2026-10-06T11:00:00.000Z",
        body_preview: "The container has been sitting since Monday.",
        body_text: "The container has been sitting since Monday.",
        body_html: null,
      },
      {
        email_message_id: "m-2",
        direction: "IN",
        from_address: "ops@maersk.cm",
        from_name: "Maersk Ops",
        to_address: ["ops@smartls.test"],
        cc_address: ["billing@maersk.cm"],
        folder: "INBOX",
        is_read: true,
        has_attachment: false,
        received_at: "2026-10-07T09:15:00.000Z",
        body_preview: "Please confirm the charges before Friday.",
        body_text: "Please confirm the charges before Friday.",
        body_html: null,
      },
    ],
  },
  "/tenant/mail/threads": threads(40),
  "/tenant/me/preferences/shell": {
    ribbonPinned: true,
    railPins: null,
    railHintSeen: true,
  },
};

function payloadFor(pathname: string): unknown {
  let best: string | null = null;
  for (const key of Object.keys(ROUTES)) {
    if (
      (pathname === key || pathname.startsWith(key)) &&
      (best === null || key.length > best.length)
    )
      best = key;
  }
  // An unmocked lookup resolves to an empty list rather than a 404: a screen
  // that renders its empty state is a measurable layout; a screen that renders
  // an error banner is a measurement of the harness.
  return best ? ROUTES[best] : [];
}

export async function fakeApi(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname.replace(
      /^\/api/,
      "",
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      // X-Total-Count is what the paged hooks read; without it a paged screen
      // reports "0 of 0" under a full table.
      headers: {
        "X-Total-Count": "60",
        "Access-Control-Expose-Headers": "X-Total-Count",
      },
      body: JSON.stringify(payloadFor(pathname)),
    });
  });
}

/**
 * Seed the persisted refresh token so the app boots signed in.
 *
 * Theme and density are pinned too. Both are persisted preferences, and a gate
 * that measures row height must not depend on what some earlier spec chose —
 * `density` is a parameter rather than a constant precisely so the density spec
 * can set it here, in ONE init script, instead of adding a second one that races
 * this one. (Init scripts run in the order they were added, so a per-test script
 * added before `openScreen` is silently overwritten by this. Found the obvious
 * way: all three densities measured the same.)
 */
export async function seedSession(page: Page, density: Density = "default") {
  await page.addInitScript((d) => {
    localStorage.setItem("praxis.refresh", "seed-refresh-token");
    localStorage.setItem("praxis.refresh.persist", "1");
    localStorage.setItem("praxis.env", "live");
    localStorage.setItem("praxis.theme", "light");
    localStorage.setItem("praxis.density", d);
  }, density);
}

export type Density = "compact" | "default" | "comfortable";

/**
 * Navigate, and prove we arrived. `marker` is text that exists ONLY on the
 * screen under test — see the Addendum 7 note at the top of this file.
 */
export async function openScreen(
  page: Page,
  path: string,
  marker: RegExp,
  density: Density = "default",
) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await seedSession(page, density);
  await fakeApi(page);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { level: 1, name: marker })
    .waitFor({ timeout: 15_000 });
  return { errors };
}

/** The width of the routed screen's content column, in CSS pixels. */
export async function contentWidth(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector(
      "main section, main > div > section, main [class*='max-w-']",
    );
    return el ? Math.round(el.getBoundingClientRect().width) : -1;
  });
}

export async function hasHorizontalScroll(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
}

/** Desktop widths the audit measures at. 2560 is the case F2 opens with. */
export const DESKTOP_WIDTHS = [1280, 1440, 1920, 2560] as const;

/**
 * The icon rail's width — chrome the content column does not get.
 *
 * Stated here rather than measured from the page, because the point of the
 * column assertions is to catch the column changing width for a reason nobody
 * intended. Reading the rail's real width and subtracting it would make that
 * assertion true by construction: widen the rail by 40px and the test would
 * still pass while every table lost 40px. `ribbonHeight`/the rail test below
 * pin the constant against what actually renders, so the two together say
 * "the rail is this wide AND the column accounts for exactly that".
 *
 * Mirrors `--rail-w` in index.css (52px, 46px at compact density). It lives on
 * `:root` rather than in `.rail` because the title bar's app mark centres itself
 * on the same width.
 */
export const RAIL_PX = 52;

/** The rail's rendered width, or -1 when it is not there (below `md`). */
export async function railWidth(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".rail");
    return el ? Math.round(el.getBoundingClientRect().width) : -1;
  });
}

/** The ribbon's rendered height, or -1 when it is not there. */
export async function ribbonHeight(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".ribbon");
    return el ? Math.round(el.getBoundingClientRect().height) : -1;
  });
}
