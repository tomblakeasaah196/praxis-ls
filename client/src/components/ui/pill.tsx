/** Status pill — thin wrapper over the design-system `.status` + `.st-*` classes
 *  so screens use a typed `tone` instead of remembering class names. */
import * as React from "react";
import { cn } from "@/lib/cn";
import { enumLabel } from "@/lib/format";

export type Tone = "ok" | "warn" | "bad" | "blue" | "orange" | "mute";

const TONE_CLASS: Record<Tone, string> = {
  ok: "st-ok",
  warn: "st-warn",
  bad: "st-bad",
  blue: "st-blue",
  orange: "st-orange",
  mute: "st-mute",
};

/** String children are humanized ("POSTED_LOCKED" → "Posted locked", "OPEN" →
 *  "Open") — the Lovable reference never shows SCREAMING enum tokens. Pass a
 *  non-string child (e.g. <span>…</span>) to opt out. */
export function Pill({ tone = "mute", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  const content = typeof children === "string" ? enumLabel(children) : children;
  return <span className={cn("status", TONE_CLASS[tone], className)}>{content}</span>;
}

/** Active/Inactive convenience for the `is_active` flag most master-data rows carry. */
export function ActivePill({ active }: { active: boolean }) {
  return <Pill tone={active ? "ok" : "mute"}>{active ? "Active" : "Inactive"}</Pill>;
}
