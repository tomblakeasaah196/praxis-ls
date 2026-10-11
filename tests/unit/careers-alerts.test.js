"use strict";

/**
 * The careers job-alert digest (13792 follow-up).
 *
 * Guards the three things a tenant asked for after seeing a live digest:
 *   - the subject NAMES the company and, for a single role, the role;
 *   - the body opens with a greeting and names the company;
 *   - each role carries an explicit "View role" link, not only a linked title.
 *
 * And the two it must never lose while gaining those: the subscriber-typed name
 * and the role fields are escaped (this is the one place they become HTML), and
 * a tenant whose registry row has no display name falls back to the un-named
 * wording rather than mailing "New role at : ...".
 */

const mockWithTenantConnection = jest.fn();
const mockGetSettings = jest.fn();
const mockListPendingAlerts = jest.fn();
const mockMarkAlertsNotified = jest.fn();
const mockPublishedList = jest.fn();
const mockEmailSend = jest.fn();

jest.mock("../../src/services/tenant/registry.service", () => ({
  withTenantConnection: (...a) => mockWithTenantConnection(...a),
}));
jest.mock("../../src/modules/hr/careers/careers.repo", () => ({
  getSettings: (...a) => mockGetSettings(...a),
  listPendingAlerts: (...a) => mockListPendingAlerts(...a),
  markAlertsNotified: (...a) => mockMarkAlertsNotified(...a),
}));
jest.mock("../../src/modules/hr/vacancy/vacancy.repo", () => ({
  publishedList: (...a) => mockPublishedList(...a),
}));
jest.mock("../../src/services/email.service", () => ({
  send: (...a) => mockEmailSend(...a),
}));
jest.mock("../../src/config/logger", () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const careersAlerts = require("../../src/jobs/handlers/careers-alerts");

const CLIENT = { query: jest.fn() };

const META = {
  db_name: "tenant_smartls",
  slug: "smartls",
  display_name: "SMART LOGISTICS",
  public_base_url: "https://smartls.cm",
};

const VACANCY = {
  public_token: "tok-ops",
  title: "Operations Manager",
  department: "Operations",
  location: "Douala",
  closes_on: "2026-10-30",
  published_at: "2026-10-05T09:00:00Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockWithTenantConnection.mockImplementation(async (meta, env, fn) => fn(CLIENT));
  mockGetSettings.mockResolvedValue({ alerts_enabled: true });
  mockMarkAlertsNotified.mockResolvedValue(1);
  mockEmailSend.mockResolvedValue({});
});

/** The mail payload email.service.send was called with (its second argument). */
function sentMail() {
  expect(mockEmailSend).toHaveBeenCalledTimes(1);
  return mockEmailSend.mock.calls[0][1];
}

function run(metaOverride = META) {
  return careersAlerts({ data: { tenantMeta: metaOverride, env: "live" } });
}

describe("careers alert digest", () => {
  test("names the company and role in the subject, greets, and links each role", async () => {
    mockListPendingAlerts.mockResolvedValue([
      { careers_alert_id: "a1", email: "x@y.z", name: "Ama", locale: "en", unsubscribe_token: "unsub1", since: "2026-10-01T00:00:00Z" },
    ]);
    mockPublishedList.mockResolvedValue([VACANCY]);

    const res = await run();

    expect(res).toEqual({ subscribers: 1, sent: 1 });
    const mail = sentMail();
    expect(mail.subject).toBe("New role at SMART LOGISTICS: Operations Manager");
    expect(mail.html).toContain("Hello Ama,");
    expect(mail.html).toContain("Here is what SMART LOGISTICS has posted");
    // The explicit per-role action, and the link it points at.
    expect(mail.html).toContain("View role");
    expect(mail.html).toContain("https://smartls.cm/careers/tok-ops");
    expect(mail.text).toContain("View role: https://smartls.cm/careers/tok-ops");
    expect(mail.html).toContain("/careers/alerts/unsubscribe/unsub1");
  });

  test("pluralises the subject without a role title when several opened", async () => {
    mockListPendingAlerts.mockResolvedValue([
      { careers_alert_id: "a1", email: "x@y.z", name: null, locale: "en", unsubscribe_token: "u", since: null },
    ]);
    mockPublishedList.mockResolvedValue([
      VACANCY,
      { ...VACANCY, public_token: "tok-2", title: "Driver" },
    ]);

    await run();
    const mail = sentMail();
    expect(mail.subject).toBe("2 new roles at SMART LOGISTICS");
    // No name on file, so the greeting is unaddressed rather than "Hello null,".
    expect(mail.html).toContain("Hello,");
  });

  test("escapes a subscriber name and falls back when the company name is missing", async () => {
    mockListPendingAlerts.mockResolvedValue([
      { careers_alert_id: "a1", email: "x@y.z", name: "<b>Eve</b>", locale: "en", unsubscribe_token: "u", since: null },
    ]);
    mockPublishedList.mockResolvedValue([VACANCY]);

    await run({ ...META, display_name: null });
    const mail = sentMail();
    // No display name: the un-named subject, never "New role at : ...".
    expect(mail.subject).toBe("A new job opening: Operations Manager");
    expect(mail.html).toContain("Here is what has been posted since we last wrote:");
    // The subscriber-typed name is escaped where it becomes HTML.
    expect(mail.html).toContain("Hello &lt;b&gt;Eve&lt;/b&gt;,");
    expect(mail.html).not.toContain("<b>Eve</b>");
  });

  test("mails the French digest in French when the subscriber chose it", async () => {
    mockListPendingAlerts.mockResolvedValue([
      { careers_alert_id: "a1", email: "x@y.z", name: "Marie", locale: "fr", unsubscribe_token: "u", since: null },
    ]);
    mockPublishedList.mockResolvedValue([VACANCY]);

    await run();
    const mail = sentMail();
    expect(mail.subject).toBe("Nouveau poste chez SMART LOGISTICS : Operations Manager");
    expect(mail.html).toContain("Bonjour Marie,");
    expect(mail.html).toContain("Voir le poste");
  });

  test("sends nothing to a subscriber with no roles since their watermark", async () => {
    mockListPendingAlerts.mockResolvedValue([
      { careers_alert_id: "a1", email: "x@y.z", name: null, locale: "en", unsubscribe_token: "u", since: "2026-12-01T00:00:00Z" },
    ]);
    mockPublishedList.mockResolvedValue([VACANCY]); // published 2026-10-05, before the watermark

    const res = await run();
    expect(mockEmailSend).not.toHaveBeenCalled();
    expect(res).toEqual({ subscribers: 1, sent: 0 });
  });

  test("skips the whole run when alerts are switched off", async () => {
    mockGetSettings.mockResolvedValue({ alerts_enabled: false });
    const res = await run();
    expect(res).toEqual({ skipped: "alerts off" });
    expect(mockEmailSend).not.toHaveBeenCalled();
  });
});
