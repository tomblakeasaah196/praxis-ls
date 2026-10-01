/**
 * What each team message's email did, in words (tenant review of 29 Sep 2026,
 * PR 1, owner decision D8) — the pure half of `client-message-email.tsx`, kept
 * apart so that file exports only components.
 */
import { tr, tv } from "@/lib/i18n";
import { dateTimeFmt } from "@/lib/format";

export type DeliveryState =
  | "EMAILED"
  | "READ"
  | "PENDING"
  | "NEVER_SIGNED_IN"
  | "SWITCHED_OFF"
  | "ALREADY_TOLD"
  | "FAILED"
  | "NOT_EMAILED";

export type DeliveryPerson = {
  email: string;
  name: string | null;
  state: DeliveryState;
  at?: string | null;
  by?: string | null;
  manual?: boolean;
};

/** Why a person was not emailed, in words a reviewer reads. */
const NOT_EMAILED: Partial<Record<DeliveryState, string>> = {
  NEVER_SIGNED_IN: "never signed in",
  SWITCHED_OFF: "switched message emails off",
  ALREADY_TOLD: "already emailed about this conversation within the hour",
  FAILED: "the email could not be sent",
  NOT_EMAILED: "no email went out",
};

const nameOf = (p: { name: string | null; email: string }) => p.name || p.email;

/**
 * One line per outcome, the people beside it:
 *   Emailed to Elisha Godwin · 10:42 · by Tom
 *   Read in the portal by Paul — no email needed
 *   Not emailed: never signed in (Awa)
 */
export function deliveryLines(people: DeliveryPerson[] | undefined | null): string[] {
  const list = people || [];
  if (!list.length) return [];
  const lines: string[] = [];
  const emailed = list.filter((p) => p.state === "EMAILED");
  // A deliberate send is its own line — it names who pressed it.
  const byHand = new Map<string, DeliveryPerson[]>();
  for (const p of emailed.filter((x) => x.manual)) {
    const key = `${p.by || ""}|${p.at ? dateTimeFmt(p.at) : ""}`;
    byHand.set(key, [...(byHand.get(key) || []), p]);
  }
  for (const group of byHand.values()) {
    const first = group[0];
    lines.push(
      [
        tv("Emailed to {{who}}", { who: group.map(nameOf).join(", ") }),
        first.at ? dateTimeFmt(first.at) : null,
        first.by ? tv("by {{who}}", { who: first.by }) : null,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }
  const auto = emailed.filter((p) => !p.manual);
  if (auto.length) {
    lines.push([tv("Emailed to {{who}}", { who: auto.map(nameOf).join(", ") }), auto[0].at ? dateTimeFmt(auto[0].at) : null].filter(Boolean).join(" · "));
  }
  const read = list.filter((p) => p.state === "READ");
  if (read.length) lines.push(tv("Read in the portal by {{who}} — no email needed", { who: read.map(nameOf).join(", ") }));
  const pending = list.filter((p) => p.state === "PENDING");
  if (pending.length) lines.push(tv("Email on its way to {{who}} if still unread", { who: pending.map(nameOf).join(", ") }));
  for (const state of Object.keys(NOT_EMAILED) as DeliveryState[]) {
    const who = list.filter((p) => p.state === state);
    if (who.length) lines.push(`${tr("Not emailed")}: ${tr(NOT_EMAILED[state] as string)} (${who.map(nameOf).join(", ")})`);
  }
  return lines;
}
