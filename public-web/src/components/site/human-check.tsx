import * as React from "react";
import { publicApi } from "@/lib/api";
import { onHumanTokenTaken, setHumanToken, type HumanAction } from "@/lib/human-check";

/**
 * The Cloudflare Turnstile widget: the bot check in front of the message
 * button, the contact form, the quote request and the careers application.
 *
 * Renders nothing, loads nothing and reports "off" for a tenant that has not
 * entered keys in Settings › Website › Messages; the server then relies on the
 * honeypot and the timing trap, as before. With keys, it loads Cloudflare's
 * script once per page, runs in "interaction-only" mode (most visitors never
 * see it; a suspicious one is asked to tick a box), and hands each token to
 * `lib/human-check`, from which the form's request takes it.
 *
 * The secret key never reaches the browser: the site key comes from
 * `GET /public/intake/config`, which returns that and nothing else.
 */

export type HumanState = "off" | "pending" | "ready" | "error";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let config: Promise<string | null> | null = null;
/** The tenant's site key, fetched once per page load. Null when the check is off. */
export function turnstileSiteKey(): Promise<string | null> {
  if (!config) {
    config = publicApi<{ turnstile_site_key: string | null }>("/public/intake/config")
      .then((c) => c?.turnstile_site_key || null)
      // The server enforces the check whatever the browser believes, so a failed
      // read degrades to "no widget" and the form reports any refusal it gets.
      .catch(() => null);
  }
  return config;
}

let script: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!script) {
    script = new Promise<void>((resolve, reject) => {
      const el = document.createElement("script");
      el.src = SCRIPT_SRC;
      el.async = true;
      el.defer = true;
      el.onload = () => resolve();
      el.onerror = () => {
        script = null;
        reject(new Error("turnstile_unavailable"));
      };
      document.head.appendChild(el);
    });
  }
  return script;
}

export function HumanCheck({
  action,
  onState,
  className,
}: {
  action: HumanAction;
  onState?: (state: HumanState) => void;
  className?: string;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const report = React.useRef(onState);
  report.current = onState;
  const [siteKey, setSiteKey] = React.useState<string | null | undefined>(undefined);

  React.useEffect(() => {
    let live = true;
    void turnstileSiteKey().then((k) => {
      if (live) setSiteKey(k);
    });
    return () => {
      live = false;
    };
  }, []);

  React.useEffect(() => {
    if (siteKey === undefined) {
      report.current?.("pending");
      return;
    }
    if (!siteKey) {
      report.current?.("off");
      return;
    }
    let cancelled = false;
    let widgetId: string | undefined;
    report.current?.("pending");
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        widgetId = window.turnstile.render(box.current, {
          sitekey: siteKey,
          action,
          theme: "auto",
          size: "flexible",
          appearance: "interaction-only",
          callback: (token: string) => {
            setHumanToken(action, token);
            report.current?.("ready");
          },
          "expired-callback": () => {
            setHumanToken(action, null);
            report.current?.("pending");
          },
          "error-callback": () => {
            setHumanToken(action, null);
            report.current?.("error");
          },
        });
      })
      .catch(() => {
        if (!cancelled) report.current?.("error");
      });
    const off = onHumanTokenTaken(action, () => {
      report.current?.("pending");
      if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
    });
    return () => {
      cancelled = true;
      off();
      setHumanToken(action, null);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, action]);

  if (!siteKey) return null;
  return <div ref={box} className={className} />;
}
