/**
 * A tap on an ordinary notification while the app is open (tenant review of
 * 29 Sep 2026, item 1.6). The real worker script runs in a sandbox with a fake
 * `self`, as push-handler-call-ring.test.ts does: its actual behaviour.
 *
 *   - an open window is focused and asked to open the place itself, inside the
 *     SPA — no navigate, no reload, nothing typed is lost;
 *   - a window that does not answer (a page from before the listener, a frozen
 *     tab) is navigated instead, and if that is refused a new window opens;
 *   - with no window at all, a new window opens at the place;
 *   - a payload pointing somewhere else never leaves this origin.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as vm from "node:vm";

const source = readFileSync(join(__dirname, "../../public/push-handler.js"), "utf8");

type Win = {
  focusCalls: number;
  navigated: string[];
  messages: unknown[];
  postMessage: (m: unknown, transfer?: MessagePort[]) => void;
  focus: () => Promise<Win>;
  navigate: (u: string) => Promise<Win>;
};

/** A window whose page answers the worker (`answers`), or stays silent. */
function win({ answers, navigateFails = false }: { answers: boolean; navigateFails?: boolean }): Win {
  const w: Win = {
    focusCalls: 0,
    navigated: [],
    messages: [],
    postMessage: (m, transfer) => {
      w.messages.push(m);
      const port = transfer && transfer[0];
      if (answers && port) port.postMessage({ ok: true });
    },
    focus: async () => {
      w.focusCalls += 1;
      return w;
    },
    navigate: async (u) => {
      if (navigateFails) throw new TypeError("not controlled by this worker");
      w.navigated.push(u);
      return w;
    },
  };
  return w;
}

function worker(windows: Win[]) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const opened: string[] = [];
  const self = {
    location: { origin: "https://smartls.praxis-ls.com" },
    navigator: { language: "en-GB", userAgent: "Chrome" },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners[type] = fn;
    },
    registration: { showNotification: async () => {}, getNotifications: async () => [] },
    clients: {
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url);
        return null;
      },
    },
  };
  // A short wait for an answer, so the silent-window case resolves quickly.
  const fastTimeout = (fn: () => void) => setTimeout(fn, 5);
  vm.runInNewContext(source, {
    self, console, Promise, Intl, Date, URL, URLSearchParams, indexedDB: undefined,
    MessageChannel, setTimeout: fastTimeout,
  });
  async function tap(data: Record<string, unknown>) {
    let done: Promise<unknown> = Promise.resolve();
    listeners.notificationclick({
      action: "",
      notification: { data, close: () => {} },
      waitUntil: (p: Promise<unknown>) => {
        done = p;
      },
    });
    await done;
  }
  return { tap, opened };
}

describe("a tap with the app open", () => {
  it("asks the open window to open the place itself — no navigate, no new window", async () => {
    const w = win({ answers: true });
    const sw = worker([w]);
    await sw.tap({ url: "/master/clients?focus=c1&tab=Documents" });
    expect(w.focusCalls).toBe(1);
    expect(w.messages).toEqual([{ type: "praxis:navigate", url: "/master/clients?focus=c1&tab=Documents" }]);
    expect(w.navigated).toEqual([]);
    expect(sw.opened).toEqual([]);
  });

  it("navigates a window that does not answer", async () => {
    const w = win({ answers: false });
    const sw = worker([w]);
    await sw.tap({ url: "/comms/clients?client=c1&thread=general" });
    expect(w.navigated).toEqual(["/comms/clients?client=c1&thread=general"]);
    expect(sw.opened).toEqual([]);
  });

  it("opens a new window when the silent window cannot be navigated either", async () => {
    const w = win({ answers: false, navigateFails: true });
    const sw = worker([w]);
    await sw.tap({ url: "/sales/quote-requests" });
    expect(sw.opened).toEqual(["/sales/quote-requests"]);
  });

  it("with no window open, opens one at the place", async () => {
    const sw = worker([]);
    await sw.tap({ url: "/finance/receivables" });
    expect(sw.opened).toEqual(["/finance/receivables"]);
  });

  it("never sends the app to another origin, and defaults to the inbox", async () => {
    const w = win({ answers: true });
    const sw = worker([w]);
    await sw.tap({ url: "https://evil.example/phish" });
    await sw.tap({});
    expect(w.messages).toEqual([
      { type: "praxis:navigate", url: "/notifications" },
      { type: "praxis:navigate", url: "/notifications" },
    ]);
  });
});
