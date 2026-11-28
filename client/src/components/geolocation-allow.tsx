/**
 * The browser's own "use location" button — the one-tap way back from a block.
 *
 * WHY THIS EXISTS. Once a person has blocked location for the site, no script
 * can ask again: `getCurrentPosition` fails at once, a service worker has no
 * geolocation at all, there is no `permissions.request()`, and no page may
 * open the browser's own settings. Chromium 144+ ships a `<geolocation>`
 * element. The BROWSER draws it, so a tap on it is a signal no page can forge,
 * and that is what lets it put the permission prompt back in front of somebody
 * who blocked it earlier. Rendered only after `supportsGeolocationElement()`.
 *
 * WHY IT REPORTS WHAT HAPPENED (28 Nov 2026). On a tenant's phone the button
 * "did nothing at all", and nothing on the page could say why. The browser
 * refuses a tap on this element whenever it judges the element unsafe to click
 * (`isValid` false, with an `invalidReason`), and it does so silently. Two of
 * those refusals are now known and handled:
 *
 *   intersection_occluded_or_distorted  any ancestor with a backdrop blur, a
 *       filter or opacity below 1 (measured in Chromium 158: the floating
 *       toolbar's blur made it permanently dead there);
 *   intersection_changed                for about a second after the element
 *       moves, which includes the moment the dialog it sits in opens.
 *
 * The rest cannot be seen from a desktop browser, so each tap is followed: if
 * the browser neither prompts nor answers, `onOutcome("no-answer")` lets the
 * dialog say so and show the settings steps, and the reason the browser gave is
 * reported (`reportClientError`, kind `diagnostic`) with the device's user
 * agent, so the cause on real phones is on record instead of a guess.
 *
 * STYLED FOR SIZE ONLY. The browser rejects colours it considers too low in
 * contrast (`style_invalid`): the tenant's orange with white text measured
 * invalid in Chromium 158. Size, padding, radius and width are safe; colour is
 * left to the browser.
 */
import * as React from "react";
import { reportClientError } from "@/lib/error-reporting";
import { isStandalone } from "@/lib/pwa-install";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      geolocation: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

/** What a tap came to. `granted` and `answered` both mean: check again now. */
export type GeolocationOutcome =
  /** The browser produced a position: location is allowed now. */
  | "granted"
  /** The person answered the browser's question (either way). */
  | "answered"
  /** The person closed the browser's question without answering. */
  | "dismissed"
  /** Tapped before the browser would accept a tap (it had only just appeared). */
  | "not-ready"
  /** The browser accepted nothing and said nothing. */
  | "no-answer";

type GeoElement = HTMLElement & {
  isValid?: boolean;
  invalidReason?: string;
  permissionStatus?: string;
};

/** How long a tap may go without any answer before it is called unanswered.
 *  Long enough that a person still reading the browser's question is not
 *  interrupted; the question answered later still counts. */
export const NO_ANSWER_MS = 6_000;

/** Reasons that only mean "it has just appeared": a second tap will do. */
const SETTLING = new Set(["intersection_changed", "recently_attached"]);

export function GeolocationAllow({ onOutcome }: { onOutcome: (o: GeolocationOutcome) => void }) {
  const ref = React.useRef<GeoElement | null>(null);
  const outcome = React.useRef(onOutcome);
  outcome.current = onOutcome;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (o: GeolocationOutcome) => {
      if (timer) clearTimeout(timer);
      timer = null;
      outcome.current(o);
    };
    const onLocation = () => settle("granted");
    const onAction = () => settle("answered");
    const onDismiss = () => settle("dismissed");
    const onError = () => settle("answered");
    const onClick = () => {
      const valid = el.isValid !== false;
      const reason = el.invalidReason || "";
      if (!valid && SETTLING.has(reason)) {
        settle("not-ready");
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        reportClientError({
          kind: "diagnostic",
          name: "ClockLocationButton",
          message:
            `Use location got no answer: valid=${String(el.isValid)}, reason=${el.invalidReason || "none"}, ` +
            `permission=${el.permissionStatus || "unknown"}, display=${isStandalone() ? "standalone" : "browser"}`,
          route: typeof location === "undefined" ? undefined : location.pathname,
        });
        outcome.current("no-answer");
      }, NO_ANSWER_MS);
    };
    el.addEventListener("location", onLocation);
    el.addEventListener("promptaction", onAction);
    el.addEventListener("promptdismiss", onDismiss);
    el.addEventListener("error", onError);
    el.addEventListener("click", onClick);
    return () => {
      if (timer) clearTimeout(timer);
      el.removeEventListener("location", onLocation);
      el.removeEventListener("promptaction", onAction);
      el.removeEventListener("promptdismiss", onDismiss);
      el.removeEventListener("error", onError);
      el.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <geolocation
      ref={ref}
      style={{
        display: "block",
        width: "100%",
        boxSizing: "border-box",
        fontSize: "16px",
        padding: "12px 20px",
        borderRadius: "12px",
      }}
    />
  );
}
