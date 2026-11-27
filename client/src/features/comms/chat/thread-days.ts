/**
 * The logic behind `thread-aids.tsx`: where a day turns over, and whether the
 * reader is at the latest message. Kept apart from the components so both
 * stay fast-refreshable. The why is in that file's header.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { dateFmt } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

/** Within this many pixels of the end counts as "at the latest message". */
export const NEAR_BOTTOM_PX = 160;

function localDay(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today", "Yesterday", or the day-first date. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const key = localDay(iso);
  if (key === localDay(now.toISOString())) return tr("Today");
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === localDay(y.toISOString())) return tr("Yesterday");
  return dateFmt(iso);
}

/**
 * True when `iso` falls on a different local day from `prevIso`, which is
 * where a divider goes. The first message always opens a day.
 */
export function startsNewDay(
  iso?: string | null,
  prevIso?: string | null,
): boolean {
  const key = localDay(iso);
  if (!key) return false;
  return key !== localDay(prevIso);
}

/**
 * Track whether the reader is at the latest message, and how many messages
 * from other people have arrived since they left it.
 *
 * `messages` is the thread in order; `isMine` says which of them the reader
 * sent, because your own message is never news to you. `resetKey` names the
 * conversation: when it changes, the next page is a new baseline rather than
 * a burst of arrivals.
 */
export function useLatestTracker<T extends { message_id: string }>(
  scrollerRef: React.RefObject<HTMLElement | null>,
  messages: T[],
  isMine: (m: T) => boolean,
  resetKey?: string | null,
) {
  const [atBottom, setAtBottom] = React.useState(true);
  const [unseen, setUnseen] = React.useState(0);
  const atBottomRef = React.useRef(true);
  const seen = React.useRef<Set<string> | null>(null);
  const reduced = usePrefersReducedMotion();

  React.useEffect(() => {
    seen.current = null;
    atBottomRef.current = true;
    setAtBottom(true);
    setUnseen(0);
  }, [resetKey]);

  // Count arrivals. The first page is the baseline, not news.
  const isMineRef = React.useRef(isMine);
  isMineRef.current = isMine;
  React.useEffect(() => {
    if (!messages.length) return;
    if (!seen.current) {
      seen.current = new Set(messages.map((m) => m.message_id));
      return;
    }
    let fresh = 0;
    for (const m of messages) {
      if (seen.current.has(m.message_id)) continue;
      seen.current.add(m.message_id);
      if (!isMineRef.current(m)) fresh += 1;
    }
    if (fresh && !atBottomRef.current) setUnseen((n) => n + fresh);
  }, [messages]);

  const onScroll = React.useCallback((el: HTMLElement) => {
    const bottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  }, []);

  // Keep the latest message in view when the pane shrinks under a reader who
  // was looking at it: the keyboard opening, a reply bar, a growing composer.
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let last = el.clientHeight;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      if (h < last && atBottomRef.current) el.scrollTop = el.scrollHeight;
      last = h;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollerRef]);

  const jump = React.useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: reduced ? "auto" : "smooth",
      });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    atBottomRef.current = true;
    setAtBottom(true);
    setUnseen(0);
  }, [scrollerRef, reduced]);

  return { atBottom, unseen, onScroll, jump };
}
