/**
 * A tap on an alert opens the thing — inside the running app, without a
 * reload (tenant review of 29 Sep 2026, PR 1, item 1.6).
 *
 * ── WHAT WAS BROKEN ─────────────────────────────────────────────────────────
 *
 * The service worker's generic tap called `client.navigate(url)` and swallowed
 * its rejection, so with the app already open the window came forward on the
 * page it was on. The bell is a plain `<Link>`, so a click whose link was the
 * page already open refetched nothing, and the live socket only moved the
 * badge — Tom had to press reload to see the RCCM a client had just sent.
 *
 * ── THE THREE PIECES, ALL HERE ──────────────────────────────────────────────
 *
 *   · `useWorkerNavigation` — the ONE app-wide listener for the worker's
 *     `praxis:navigate` (public/push-handler.js): it routes inside the SPA and
 *     answers on the message's port, so the worker knows a window took it and
 *     falls back to `navigate()` / `openWindow()` only when none did. It
 *     replaced the calls-only listener comms-live.tsx used to carry.
 *   · `useOpenInApp` — what the bell and a toast call: navigate, or — when
 *     the link IS the page already open — refresh that page's data.
 *   · `refreshFor` — what a live `notification:new` invalidates on the screen
 *     that is open: just the queries of that screen (Client 360, the Client
 *     inbox, Quote requests), never a global refetch.
 *
 * Screens that fetch by hand rather than through TanStack Query (the client
 * chat panel, the 360's dossier) listen for `REFRESH_EVENT` with
 * `useRefreshEvent`.
 */
import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { TENANT_KEY } from "./query-client";

/** Fired on `window` when the open screen should re-read what it shows. */
export const REFRESH_EVENT = "praxis:refresh";

export type RefreshDetail = { scope: "screen" | "client" | "inbox" | "quotes"; clientId?: string | null };

/** A same-origin path, or null — never an address somewhere else. */
export function appPath(raw: unknown, origin = typeof window !== "undefined" ? window.location.origin : "http://localhost"): string | null {
  if (typeof raw !== "string" || !raw) return null;
  if (raw.startsWith("//")) return null;
  try {
    const u = new URL(raw, origin);
    if (u.origin !== origin) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

/** Is `target` the page already open? Same path and the same query, in any order. */
export function samePlace(target: string, current: { pathname: string; search: string }): boolean {
  try {
    const t = new URL(target, "http://x");
    if (t.pathname.replace(/\/+$/, "") !== current.pathname.replace(/\/+$/, "")) return false;
    const a = new URLSearchParams(t.search);
    const b = new URLSearchParams(current.search);
    a.sort();
    b.sort();
    return a.toString() === b.toString();
  } catch {
    return false;
  }
}

export function emitRefresh(detail: RefreshDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<RefreshDetail>(REFRESH_EVENT, { detail }));
}

/** Re-read the queries whose key mentions any of `needles` (paths, ids, function sources). */
export function invalidateMatching(qc: QueryClient, needles: (string | RegExp)[]): void {
  if (!needles.length) return;
  void qc.invalidateQueries({
    predicate: (q) => {
      const key = q.queryKey;
      if (!Array.isArray(key) || key[0] !== TENANT_KEY) return false;
      let text: string;
      try {
        text = JSON.stringify(key);
      } catch {
        return false;
      }
      return needles.some((n) => (typeof n === "string" ? text.includes(n) : n.test(text)));
    },
  });
}

/** The open page's own data: its ACTIVE queries only, and its hand-fetched parts. */
export function refreshScreen(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: [TENANT_KEY], type: "active" });
  emitRefresh({ scope: "screen" });
}

/** The client a link or a location is about (`?focus=<id>` on the Clients screen, `?client=` in the inbox). */
function clientOf(search: string): string | null {
  const p = new URLSearchParams(search);
  return p.get("focus") || p.get("client") || null;
}

export type LiveArrival = {
  category?: string | null;
  link_url?: string | null;
  event_type_key?: string | null;
  entity_ref?: string | null;
};

/**
 * What a live notification refreshes on the screen that is open — and nothing
 * when it is about something else. Pure, so the mapping is tested on its own.
 */
export function refreshFor(n: LiveArrival, at: { pathname: string; search: string }): { needles: (string | RegExp)[]; detail: RefreshDetail } | null {
  const link = n.link_url ? new URL(n.link_url, "http://x") : null;
  const linkClient = link ? clientOf(link.search) : null;
  const key = String(n.event_type_key || "");
  const isClientActivity =
    n.category === "clients" || /^(client_message|client_request|payment_proof|portal)\./.test(key);
  const isQuote = /^quote_request\./.test(key) || (link ? /quote-requests/.test(link.pathname) : false);

  // Client 360 — Portal, Documents, Messages: the one client's lists.
  if (at.pathname.startsWith("/master/clients")) {
    const open = clientOf(at.search);
    if (!open || !isClientActivity) return null;
    if (linkClient && linkClient !== open) return null;
    return {
      needles: ["/portal/client-requests", "/portal/payment-proofs", "/portal/chat", `/portal/clients/${open}`, `/clients/${open}`, open],
      detail: { scope: "client", clientId: open },
    };
  }
  // Comms › Clients — the inbox and the open conversation.
  if (at.pathname.startsWith("/comms/clients")) {
    if (!isClientActivity) return null;
    return { needles: ["/portal/chat"], detail: { scope: "inbox", clientId: linkClient } };
  }
  // Sales & CRM › Quote requests.
  if (/quote-requests/.test(at.pathname)) {
    if (!isQuote) return null;
    return { needles: [/quote[-_]?request/i], detail: { scope: "quotes" } };
  }
  return null;
}

/** Re-read the open screen's data when a live notification is about it (C3). */
export function useLiveRefresh(): (n: LiveArrival) => void {
  const qc = useQueryClient();
  const location = useLocation();
  const where = React.useRef(location);
  where.current = location;
  return React.useCallback(
    (n: LiveArrival) => {
      const hit = refreshFor(n, where.current);
      if (!hit) return;
      invalidateMatching(qc, hit.needles);
      emitRefresh(hit.detail);
    },
    [qc],
  );
}

/**
 * Open a link inside the app — or, when it is the page already open, refresh
 * that page instead of doing nothing (C2: the bell is a plain Link, and a
 * same-URL navigation re-reads nothing).
 */
export function useOpenInApp(): (url: string | null | undefined) => void {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const where = React.useRef(location);
  where.current = location;
  return React.useCallback(
    (url) => {
      const target = appPath(url);
      if (!target) return;
      if (samePlace(target, where.current)) refreshScreen(qc);
      else navigate(target);
    },
    [navigate, qc],
  );
}

/**
 * The ONE listener for the service worker's `praxis:navigate` (C1). Mounted
 * once in the app shell. Answers `{ ok: true }` on the message's port when it
 * routed, so the worker falls back to a navigation or a new window only when
 * no window took the tap.
 */
export function useWorkerNavigation(): void {
  const open = useOpenInApp();
  const openRef = React.useRef(open);
  openRef.current = open;
  React.useEffect(() => {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (!sw || typeof sw.addEventListener !== "function") return;
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; url?: string } | null;
      if (!msg || msg.type !== "praxis:navigate") return;
      const target = appPath(msg.url);
      const port = ev.ports && ev.ports[0];
      if (!target) {
        port?.postMessage({ ok: false });
        return;
      }
      openRef.current(target);
      port?.postMessage({ ok: true });
    };
    sw.addEventListener("message", onMessage);
    return () => sw.removeEventListener("message", onMessage);
  }, []);
}

/** Run `fn` when the open screen is asked to refresh (hand-fetched screens). */
export function useRefreshEvent(fn: (detail: RefreshDetail) => void): void {
  const ref = React.useRef(fn);
  ref.current = fn;
  React.useEffect(() => {
    const on = (e: Event) => ref.current(((e as CustomEvent<RefreshDetail>).detail || { scope: "screen" }) as RefreshDetail);
    window.addEventListener(REFRESH_EVENT, on);
    return () => window.removeEventListener(REFRESH_EVENT, on);
  }, []);
}
