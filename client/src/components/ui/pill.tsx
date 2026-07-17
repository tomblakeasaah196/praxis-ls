/** Status pill — thin wrapper over the design-system `.status` + `.st-*` classes
 *  so screens use a typed `tone` instead of remembering class names. */
import * as React from "react";
import { cn } from "@/lib/cn";

export type Tone = "ok" | "warn" | "bad" | "blue" | "orange" | "mute";

const TONE_CLASS: Record<Tone, string> = {
  ok: "st-ok",
  warn: "st-warn",
  bad: "st-bad",
  blue: "st-blue",
  orange: "st-orange",
  mute: "st-mute",
};

export function Pill({ tone = "mute", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("status", TONE_CLASS[tone], className)}>{children}</span>;
}

/** Active/Inactive convenience for the `is_active` flag most master-data rows carry. */
export function ActivePill({ active }: { active: boolean }) {
  return <Pill tone={active ? "ok" : "mute"}>{active ? "Active" : "Inactive"}</Pill>;
}
