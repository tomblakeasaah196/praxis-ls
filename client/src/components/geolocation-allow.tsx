/**
 * The browser's own "use location" button — the one-tap way back from a block.
 *
 * WHY THIS EXISTS. Once a person has blocked location for the site, no script
 * can ask again: `getCurrentPosition` fails at once, a service worker has no
 * geolocation at all, and there is no `permissions.request()`. Until now the
 * only way back was four steps through the browser's site settings.
 *
 * Chromium 144+ ships a `<geolocation>` element. The BROWSER draws it, so a tap
 * on it is a signal no page can forge, and that is what lets it put the
 * permission prompt back in front of somebody who blocked it earlier. Where it
 * exists, the recovery card offers it first; everywhere else the card falls
 * back to the written steps, so this component is never the only way through.
 *
 * Rendered only after `supportsGeolocationElement()` said yes: in a browser
 * without it the tag would be an unknown inline element with nothing inside.
 *
 * The events are listened to broadly on purpose. A tap can end in a position,
 * an error, or a prompt the person answered or dismissed; whichever arrives,
 * `onSettled` re-checks the permission rather than trusting the payload of an
 * event shape that is still new.
 */
import * as React from "react";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      geolocation: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

const SETTLE_EVENTS = ["location", "promptaction", "promptdismiss", "error"] as const;

export function GeolocationAllow({ onSettled }: { onSettled: () => void }) {
  const ref = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const settle = () => onSettled();
    SETTLE_EVENTS.forEach((e) => el.addEventListener(e, settle));
    return () => SETTLE_EVENTS.forEach((e) => el.removeEventListener(e, settle));
  }, [onSettled]);
  return <geolocation ref={ref} />;
}
