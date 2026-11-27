/**
 * The service worker answers only for this origin's own fonts and images.
 *
 * When it answered for every site's, it re-fetched them under the CSP `sw.js`
 * is served with (no `connect-src`, so `default-src 'self'`), and every one was
 * refused inside the browser: "Show images" in mail drew a broken image for
 * every sender. `config/sw-routes.ts` has the whole story.
 */
import { describe, expect, it } from "vitest";
import { isOwnFont, isOwnImage } from "../../config/sw-routes";

const req = (destination: string) => ({ destination }) as Request;

describe("the service worker's runtime routes", () => {
  it("cache our own images and fonts", () => {
    expect(isOwnImage({ request: req("image"), sameOrigin: true })).toBe(true);
    expect(isOwnFont({ request: req("font"), sameOrigin: true })).toBe(true);
  });

  it("leave another site's images and fonts to the browser", () => {
    expect(isOwnImage({ request: req("image"), sameOrigin: false })).toBe(false);
    expect(isOwnFont({ request: req("font"), sameOrigin: false })).toBe(false);
  });

  it("match only their own kind of request", () => {
    expect(isOwnImage({ request: req("font"), sameOrigin: true })).toBe(false);
    expect(isOwnFont({ request: req("image"), sameOrigin: true })).toBe(false);
    expect(isOwnImage({ request: req(""), sameOrigin: true })).toBe(false);
  });

  /** Workbox writes each matcher into sw.js with `toString()`, so it may not
   *  reach for anything outside its own body: an import would be undefined. */
  it("are self-contained, because workbox serialises them into sw.js", () => {
    for (const fn of [isOwnFont, isOwnImage]) {
      const rebuilt = new Function(`return (${fn.toString()})`)() as typeof fn;
      expect(rebuilt({ request: req("image"), sameOrigin: true })).toBe(fn({ request: req("image"), sameOrigin: true }));
      expect(rebuilt({ request: req("font"), sameOrigin: false })).toBe(false);
    }
  });
});
