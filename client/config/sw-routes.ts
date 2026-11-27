/**
 * Which requests the service worker's runtime caches answer.
 *
 * Kept out of `vite.config.ts` so the rule can be asserted: the config file is
 * not importable from a test without booting the whole build.
 *
 * ── OUR OWN FILES ONLY ──────────────────────────────────────────────────────
 *
 * Both routes used to match on `request.destination` alone, so they answered
 * for every image and font the page asked for, from any site. A route that
 * answers re-fetches the file with the worker's own `fetch()`, and a worker's
 * fetches are checked against the Content-Security-Policy `sw.js` was served
 * with: helmet's defaults, which set no `connect-src`, so `default-src 'self'`.
 * Every request to another site was refused inside the browser, before it left
 * it. The page's own `img-src https:` never got a say.
 *
 * That is how "Show images" in mail drew a broken image for every sender (27
 * Nov 2026): the reading pane's frame is a `srcdoc` document with
 * `allow-same-origin`, so it belongs to this worker too. Mail images now come
 * through our own proxy, but the same refusal waited for any other image or
 * font hosted elsewhere, such as a tenant logo on a CDN, which the server's
 * policy explicitly allows. A request this worker does not answer goes to the
 * network exactly as if there were no worker, under the page's own policy.
 *
 * What is cached is still everything the comments in `vite.config.ts` promise:
 * the fonts and the brand media are files this origin serves.
 */

/** What a Workbox `urlPattern` callback is handed, as far as these rules read it. */
export type RouteMatch = { request: Request; sameOrigin: boolean };

/** A font this origin serves. */
export const isOwnFont = ({ request, sameOrigin }: RouteMatch): boolean =>
  sameOrigin && request.destination === "font";

/** An image this origin serves: the logo, the login hero, avatars, /media. */
export const isOwnImage = ({ request, sameOrigin }: RouteMatch): boolean =>
  sameOrigin && request.destination === "image";
