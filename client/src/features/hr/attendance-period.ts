/**
 * The period chips behind every attendance history view.
 *
 * Pure and separate from the widget so the boundary arithmetic can be tested
 * without rendering anything — it is the part that goes subtly wrong (a "month"
 * that starts on the 2nd, a "year" that asks for 367 days and 422s against the
 * server's window cap).
 *
 * ── WHY THE WINDOW ENDS YESTERDAY ───────────────────────────────────────────
 *
 * Reconciliation runs on COMPLETED days, so `attendance_day` never holds today.
 * A window that ended today would put a permanently empty row at the bottom of
 * every table and drag every average down by one absent-looking day. Today's
 * punches are the Today tab's job; this is the reconciled record.
 *
 * ── UTC, DELIBERATELY ───────────────────────────────────────────────────────
 *
 * These produce calendar dates (YYYY-MM-DD) for a server that resolves them in
 * the workplace zone. Building them from the BROWSER's local calendar would
 * mean a manager in London and one in Douala asking for different months on the
 * same click. The one thing that must follow the viewer is which day is
 * "today", and a date-only boundary is stable enough for that.
 */

export type PeriodKey = "7d" | "month" | "quarter" | "year" | "custom";

export type Period = { from: string; to: string };

/** Server cap (§4). Kept here so the UI never composes a window it will 422 on. */
export const MAX_WINDOW_DAYS = 366;

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** Yesterday — the last day reconciliation can have finished. */
export function lastClosedDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY);
}

/**
 * Resolve a chip into a window.
 *
 * Every period is measured from `to` — the last CLOSED day — not from today.
 * That is what makes the 1st of a month behave: on 1 August the last closed day
 * is 31 July, so "Month" is the whole of July rather than an empty
 * August-to-date. It also means `from` is always derived from `to`'s own
 * period and can never overtake it, so there is no clamp here to wonder about.
 */
export function periodFor(key: Exclude<PeriodKey, "custom">, now: Date = new Date()): Period {
  const to = lastClosedDay(now);
  const y = to.getUTCFullYear();
  const m = to.getUTCMonth();

  let from: Date;
  switch (key) {
    case "7d":
      // Seven days INCLUSIVE of `to`, so the chip means what it says.
      from = new Date(to.getTime() - 6 * DAY);
      break;
    case "month":
      from = utc(y, m, 1);
      break;
    case "quarter":
      from = utc(y, Math.floor(m / 3) * 3, 1);
      break;
    case "year":
      from = utc(y, 0, 1);
      break;
    default:
      from = utc(y, m, 1);
  }
  return { from: iso(from), to: iso(to) };
}

/** Is this window one the server will accept? */
export function windowDays({ from, to }: Period): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
}

/*
 * The server's own shape (`/^\d{4}-\d{2}-\d{2}$/`). A bare `Date.parse` is not
 * enough: it happily reads "01/08/2026" as 8 January, so a mistyped date would
 * pass here and come back as a 422 the person cannot act on — or worse, quietly
 * fetch the wrong month.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function windowError({ from, to }: Period): string | null {
  if (!from || !to) return "Choose both ends of the window.";
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return "Use dates in the form YYYY-MM-DD.";
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return "Use dates in the form YYYY-MM-DD.";
  if (to < from) return "The end of the window must not precede its start.";
  if (windowDays({ from, to }) > MAX_WINDOW_DAYS) return "Ask for at most a year at a time.";
  return null;
}

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  "7d": "7 days",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
  custom: "Custom",
};
