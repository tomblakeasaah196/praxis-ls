/**
 * How the time clock writes durations. Kept out of the component file so the
 * component module exports components only (fast refresh), and so the two
 * formats are tested on their own.
 */

/** "7h 42m", "8h", "25m". */
export function hoursFmt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

/** "02:14:09" — hours keep counting past 24 rather than wrapping. */
export function timerFmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
