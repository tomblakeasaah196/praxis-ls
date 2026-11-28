/**
 * The clock on a phone: the floating menu it lives in, and the browser's own
 * location button in the clock-in dialog.
 *
 * ── THE REPORTS THIS GATE EXISTS FOR (28 Nov 2026) ─────────────────────────
 *
 *   1. "Use location does not work." The button is the browser's
 *      `<geolocation>` element, and the browser silently refuses taps on it
 *      whenever it judges it unsafe to click. Inside the floating menu's
 *      backdrop blur it was refused for good (`isValid` false,
 *      `intersection_occluded_or_distorted`); in the dialog it is refused for
 *      about a second while the dialog settles. jsdom has no such element and
 *      no layout, so only a real browser can say whether it ends up clickable.
 *      Where the browser has no `<geolocation>` (older Chromium), that half is
 *      skipped and the rest still runs.
 *
 *   2. "The floating dropdown is too populated." One plain list now: the clock
 *      first, no Notifications (the top bar's bell), no Feedback or Reload
 *      (the account menu), and no blur anywhere in it.
 *
 *   3. A tap on the menu button opened it and shut it again: the tap's
 *      compatibility mouseenter and focus opened it, the click toggled it
 *      closed. So the menu is opened here with a real touch tap.
 */
import { test, expect, devices, type Page } from "@playwright/test";
import { seedSession, fakeApi } from "./fixtures";

const { defaultBrowserType: _browser, ...PHONE } = devices["Pixel 7"];

/** An employee, not on shift, on a device the register knows, with location
 *  BLOCKED for the site, which is the state the reports came from. */
async function openAsBlockedEmployee(page: Page) {
  await page.addInitScript(() => {
    const original = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = ((d: PermissionDescriptor) =>
      d && d.name === "geolocation"
        ? Promise.resolve({ state: "denied", addEventListener() {}, removeEventListener() {} } as unknown as PermissionStatus)
        : original(d)) as typeof navigator.permissions.query;
  });
  await seedSession(page);
  await fakeApi(page);
  await page.route("**/api/tenant/attendance/me**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        linked: true,
        open: null,
        done: null,
        expected_minutes: 480,
        undo_until: null,
        device: { known: true, hr_device_id: "d-1", label: "My phone", status: "TRUSTED" },
      }),
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Quick actions (drag to move)" }).waitFor({ timeout: 15_000 });
}

/** Whatever on the way up from `el` would make the browser refuse a tap. */
const DISTORTING = `(el) => {
  const out = [];
  for (let e = el; e; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.backdropFilter && cs.backdropFilter !== "none") out.push(e.tagName + " backdrop-filter");
    if (cs.filter && cs.filter !== "none") out.push(e.tagName + " filter");
    if (cs.opacity !== "1") out.push(e.tagName + " opacity " + cs.opacity);
  }
  return out;
}`;

test.describe("the clock on a phone", () => {
  test.use(PHONE);

  test("a tap opens one plain list with the clock first, and nothing that moved out", async ({ page }) => {
    await openAsBlockedEmployee(page);
    await page.getByRole("button", { name: "Quick actions (drag to move)" }).tap();
    const menu = page.locator("#quick-actions-menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button").first()).toHaveText("Clock In");
    await expect(menu.getByRole("button", { name: "Help" })).toBeVisible();
    for (const gone of [/Notifications/, /Feedback/, /Reload/]) {
      await expect(menu.getByRole("button", { name: gone })).toHaveCount(0);
    }
    const distorted = await menu.evaluate(new Function(`return (${DISTORTING})`)() as (el: Element) => string[]);
    expect(distorted.filter((d) => /backdrop-filter|filter/.test(d))).toEqual([]);
  });

  test("on a blocked site, Clock In asks first, and the browser's own button becomes tappable", async ({ page }) => {
    await openAsBlockedEmployee(page);
    await page.getByRole("button", { name: "Quick actions (drag to move)" }).tap();
    await page.locator("#quick-actions-menu").getByRole("button", { name: "Clock In" }).tap();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Location is blocked for this site")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Clock In Without Location" })).toBeVisible();

    const supported = await page.evaluate(() => "HTMLGeolocationElement" in window);
    test.skip(!supported, "this Chromium has no <geolocation> element; the dialog shows the written steps instead");

    const button = dialog.locator("geolocation");
    await expect(button).toBeVisible();
    // It settles: invalid for about a second while the dialog appears, then valid.
    await expect
      .poll(() => button.evaluate((el) => (el as HTMLElement & { isValid?: boolean }).isValid), { timeout: 5_000 })
      .toBe(true);
    const distorted = await button.evaluate(new Function(`return (${DISTORTING})`)() as (el: Element) => string[]);
    expect(distorted).toEqual([]);
    // The written steps are one tap away, not on the page.
    await expect(dialog.getByRole("button", { name: "Use Settings Instead" })).toBeVisible();
  });
});
