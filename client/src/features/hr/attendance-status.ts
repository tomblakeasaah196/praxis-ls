/**
 * Attendance status → pill tone.
 *
 * Its own module, not a companion export beside a component: React Fast Refresh
 * only works on files that export components alone, and every attendance
 * surface (the day log, the history table, Employee 360) needs this map. One
 * definition means PRESENT is never green on one screen and grey on another.
 */
import { type Tone } from "@/components/ui/pill";

export const STATUS_TONE: Record<string, Tone> = {
  PRESENT: "ok",
  LATE: "warn",
  ABSENT: "bad",
  ON_LEAVE: "blue",
  HOLIDAY: "mute",
  WEEKEND: "mute",
  OFF: "mute",
};
