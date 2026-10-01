import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Component tests read the dictionary AS WRITTEN.
 *
 * The Title Case standard (owner decision D5) is applied at render by one
 * i18next post-processor, and the suites here assert against the dictionary
 * itself — `findByText(en.site.trackPage.failedTitle)` — which is what keeps a
 * test from hard-coding a string the dictionary later changes. With the
 * standard on, every such assertion would have to re-derive the casing, which
 * is testing `titleCase` seventy-seven times instead of once.
 *
 * So the harness pins "As written", the tenant setting that turns it off, and
 * the standard is tested where it lives: `lib/label-case.test.ts` (the rule,
 * the tokens, the toggle, a tenant override) and `site-header.test.tsx` (the
 * real header, rendered with it on). A test that wants it on says so.
 *
 * A mock FACTORY rather than one call here, because several suites
 * `vi.resetModules()` and import the app again — a fresh `label-case` module
 * starts on the production default, and a one-off call would have pinned only
 * the first instance. The factory runs for every instance.
 */
vi.mock("@/lib/label-case", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/label-case")>();
  actual.setLabelCase("AS_WRITTEN");
  return actual;
});

/**
 * Every test here renders a page that a stranger reaches with no session, so
 * the harness must not accidentally provide one: `lib/api.ts` reads no token
 * store and no `X-Praxis-Env` header, and nothing in these tests seeds either.
 *
 * fetch itself is stubbed per test (vi.stubGlobal) rather than by a global mock,
 * so a request nobody declared fails loudly instead of returning `undefined`.
 */
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

/**
 * jsdom implements no layout, so it has no element scrolling — the same gap
 * `client/src/test/setup.ts` already shims, which this app never picked up.
 *
 * WHY IT SURFACED AS AN INTERMITTENT FAILURE, WHICH IS THE PART WORTH KEEPING.
 *
 * `LongCopy.jump()` defers its scroll into `requestAnimationFrame`, so the page
 * scrolls to the section's EXPANDED position rather than to where the collapsed
 * summary used to be. That is correct behaviour, and it puts the call in a
 * callback no test awaits — which makes it a race against the `cleanup()` above:
 *
 *   callback fires AFTER cleanup  → the node is gone, `getElementById` returns
 *                                   null, `?.` short-circuits, nothing happens.
 *   callback fires BEFORE cleanup → the node exists, `.scrollIntoView` is
 *                                   undefined, and it throws where nothing can
 *                                   catch it.
 *
 * Runner timing decides which. On a contended CI runner it landed first and
 * failed the job with a `TypeError` while all 428 tests passed — a red build
 * with a green test report, on a PR that had not touched this app at all.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
