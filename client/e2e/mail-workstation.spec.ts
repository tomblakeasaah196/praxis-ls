/**
 * Smart Mail: the three-pane workstation, measured.
 *
 * ── WHY THIS SPEC EXISTS ────────────────────────────────────────────────────
 *
 * The mailbox was written as a three-pane layout and shipped as a document that
 * scrolls, for two years, with every test green. Nothing caught it because
 * nothing could: `ThreadList`'s `overflow-y-auto` was present and correct in the
 * source, the class names a reviewer looks for were all there, and jsdom has no
 * layout engine, so a unit test cannot tell a pane that scrolls from one that
 * grew to its content. The defect only exists in a browser, and only as a
 * NUMBER: a ~100px row, four strips of chrome, and a page that scrolls instead
 * of three panes that do.
 *
 * That is the same argument `layout.spec.ts` opens with, so this is the same
 * kind of gate: numbers, not screenshots. Each assertion is one of the
 * complaints the restructure answered, in the form that would show it coming
 * back.
 */
import { expect, test } from "@playwright/test";
import { hasHorizontalScroll, openScreen, seedSession } from "./fixtures";

/** The conversation rows. SCOPED to the list: the shell's own navigation
 *  contributes four more `<li>`s, and an unscoped `getByRole("listitem")`
 *  measured one of those at 16px and reported it as the row height. */
const ROWS = 'ul[aria-label="Conversations"] > li';
/** The row's own button, which is also the roving tabindex's target. */
const ROW_BUTTON = '[aria-keyshortcuts="Enter x s"]';

/** The list pane's scroller, the reading pane's, and the document. */
async function scrollers(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const list = document.querySelector('ul[aria-label="Conversations"]');
    const read = document.querySelector("main article")?.closest("div.overflow-y-auto");
    const el = (n: Element | null | undefined) =>
      n
        ? {
            scrollH: Math.round(n.scrollHeight),
            clientH: Math.round(n.clientHeight),
            scrolls: n.scrollHeight > n.clientHeight + 1,
          }
        : null;
    return {
      list: el(list),
      read: el(read),
      doc: {
        scrollH: Math.round(document.documentElement.scrollHeight),
        clientH: Math.round(document.documentElement.clientHeight),
      },
    };
  });
}

test.describe("Smart Mail as a workstation", () => {
  test("THE LIST PANE SCROLLS, NOT THE PAGE", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { errors } = await openScreen(page, "/comms/mail", /^Mail$/);
    await page.locator(ROWS).first().waitFor();

    const s = await scrollers(page);
    // Forty conversations against a 900px viewport: the pane has to overflow,
    // or the fixture is too small to be measuring anything.
    expect(s.list, "the conversation list has no scroller").not.toBeNull();
    expect(s.list!.scrolls, `list pane ${s.list!.scrollH}px in ${s.list!.clientH}px`).toBe(true);

    // And the DOCUMENT does not. This is the assertion the whole change is
    // about: before it, the forty rows were in the page's flow, so reading a
    // conversation carried the list and the chrome off the top of the screen.
    expect(s.doc.scrollH).toBeLessThanOrEqual(s.doc.clientH + 1);
    expect(await hasHorizontalScroll(page)).toBe(false);
    expect(errors, "page errors").toEqual([]);
  });

  test("the reading pane scrolls itself, with the list still in place", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openScreen(page, "/comms/mail", /^Mail$/);
    const first = page.locator(ROWS).first();
    await first.waitFor();
    const before = await first.boundingBox();

    await page.locator(ROW_BUTTON).first().click();
    await page.getByRole("heading", { name: "Demurrage on MSKU1234567" }).waitFor();

    // Reading does not move the list. It did: both were in one page scroller.
    const after = await first.boundingBox();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
    const s = await scrollers(page);
    expect(s.doc.scrollH).toBeLessThanOrEqual(s.doc.clientH + 1);
  });

  /**
   * The row, at each density.
   *
   * Two lines plus 2 × `--row-py` (4 / 6 / 10px) and a 1px bottom border.
   *
   * THE PREVIOUS ROW MEASURED 101px, in this stylesheet, at every density: the
   * old markup was rebuilt inside the real page and measured rather than
   * reasoned about. `py-2.5` fixed 20px of padding, and four stacked lines
   * (counterparty + time, subject, preview, a row of pills with `mt-1`) filled
   * 80px of it. Against the 574px list pane this viewport gives, that is five
   * conversations where there are now ten.
   */
  for (const [density, height] of Object.entries({
    compact: 49,
    default: 53,
    comfortable: 61,
  } as const)) {
    test(`${density} conversation rows measure ${height}px`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await seedSession(page, density as "compact" | "default" | "comfortable");
      await openScreen(page, "/comms/mail", /^Mail$/, density as "compact" | "default" | "comfortable");
      const row = page.locator(ROWS).first();
      await row.waitFor();
      const box = await row.boundingBox();
      const measured = Math.round(box?.height ?? 0);
      expect(
        Math.abs(measured - height),
        `${density} row was ${measured}px, not ${height}px`,
      ).toBeLessThanOrEqual(2);
    });
  }

  test("SPENDS ONE STRIP OF CHROME above the first conversation", async ({ page }) => {
    /*
     * Four strips stood here: the hub's tab bar, an in-page COPY of the hub's
     * tab bar, a right-aligned Compose button alone on a row, and the search
     * form. Three remain and only one of them is this page's: the Comms tab bar
     * (the hub's, and the only way to reach the other Comms surfaces), the one
     * command strip, and the list's own selection header, which is a header on
     * the list rather than chrome above it — Outlook has one too.
     *
     * MEASURED FROM <main>, not from the viewport. The shell's own chrome has
     * its own gate (`layout.spec.ts` pins it at 94px for this density) and this
     * spec must not fail because that number moved. 162px measured, of which 24
     * is <main>'s own padding.
     */
    await page.setViewportSize({ width: 1440, height: 900 });
    await openScreen(page, "/comms/mail", /^Mail$/);
    const row = page.locator(ROWS).first();
    await row.waitFor();
    const spent = await page.evaluate((sel) => {
      const li = document.querySelector(sel)!;
      const main = document.querySelector("main")!;
      return Math.round(
        li.getBoundingClientRect().y - main.getBoundingClientRect().y,
      );
    }, ROWS);
    expect(spent, `${spent}px of chrome above the first conversation`).toBeLessThan(180);

    // And exactly ONE Mailbox link. The in-page strip was a second copy of the
    // six links the hub's own bar already carries, which is what TabbedHub
    // documents the strip as being a fallback for — and `areas.ts` defines no
    // sections for Comms, so here it was never a fallback for anything.
    await expect(page.getByRole("link", { name: "Mailbox" })).toHaveCount(1);
  });

  test("REPLY AND ARCHIVE ARE AT THE TOP OF THE READING PANE", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openScreen(page, "/comms/mail", /^Mail$/);
    await page.locator(ROW_BUTTON).first().click();
    const subject = page.getByRole("heading", { name: "Demurrage on MSKU1234567" });
    await subject.waitFor();

    /* SCOPED to the reading pane. The folder rail has an Archive button of its
     * own — it is a folder — so an unscoped lookup matches two and this spec
     * would be asserting about the rail half the time. */
    const pane = page.locator("header", { has: subject });
    const reply = pane.getByRole("button", { name: "Reply", exact: true });
    const archive = pane.getByRole("button", { name: "Archive", exact: true });
    await expect(reply).toBeVisible();
    await expect(archive).toBeVisible();

    // Above the first message, not below the last. Reply used to be the
    // footer's only contents, which was fine while the footer was pinned and it
    // never was: nothing on this screen had a height.
    const replyBox = await reply.boundingBox();
    const firstMessage = await page.locator("main article").first().boundingBox();
    expect(replyBox!.y).toBeLessThan(firstMessage!.y);

    // Archive is the point of the strip: it could not be reached from the open
    // conversation at all, only by closing it, finding its row and ticking a
    // checkbox.
    await archive.click();
    await expect(page.getByRole("heading", { name: "Demurrage on MSKU1234567" })).toBeVisible();
  });

  test("the keyboard walks the list: one tab stop, then the arrow keys", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openScreen(page, "/comms/mail", /^Mail$/);
    await page.locator(ROWS).first().waitFor();

    const rows = page.locator(ROW_BUTTON);
    await expect(rows).toHaveCount(40);
    await rows.first().focus();

    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press("j");
    await expect(rows.nth(2)).toBeFocused();
    await page.keyboard.press("k");
    await expect(rows.nth(1)).toBeFocused();

    // `x` reaches the checkbox the roving tabindex took out of the tab order.
    await page.keyboard.press("x");
    await expect(page.getByText("1 selected")).toBeVisible();

    // And Enter opens the row under the cursor, scrolled into view by the pane
    // rather than by the page.
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /Demurrage on MSKU/ })).toBeVisible();
    expect(await hasHorizontalScroll(page)).toBe(false);
  });
});
