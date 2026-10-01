/**
 * Title Case for every LABEL, applied at render (owner decision D5, tenant
 * review of 29 Sep 2026).
 *
 * ── THE STANDARD ───────────────────────────────────────────────────────────
 *
 * Every label on the website and the client portal — nav and footer links,
 * buttons, headings (the hero headline included), eyebrows, card titles, tabs,
 * form field labels, pills — renders in Title Case, in English AND French:
 * "Our Work", "Request a Quote"; "Nos Réalisations", "Demander un Devis".
 * Sentences, hints, placeholders and legal text stay as written. Which key is
 * which is decided in ONE list, `scripts/gen/site-copy-case.js`; this module
 * loads the LABEL half of it (generated, `label-keys.generated.ts`).
 *
 * ── WHY AT RENDER, AND WHY ONE POST-PROCESSOR ──────────────────────────────
 *
 * Retyping ~770 strings in two languages would be a standard that holds until
 * the next string, and it would not reach a tenant's own override from the
 * copy editor, which lands in the same i18next store as ours
 * (`site-copy.ts`). A post-processor sees every `t()` of every key, ours or the
 * tenant's, after the store has resolved it — one place, no call site to
 * remember. The casing rule itself is the financial dictionary's `titleCase`
 * (packages/shared/text/title-case.js), unchanged: small words stay small
 * ("de", "of"), acronyms stay as typed ("THC", "PDF"), elision keeps its
 * apostrophe ("d’Agence").
 *
 * ── THE TOKENS ARE NEVER CASED ─────────────────────────────────────────────
 *
 * i18next post-processes AFTER interpolation, so casing the finished string
 * would capitalise whatever was put into it — "Not marie@acme.cm?" would
 * become "Not Marie@acme.cm?", and a tenant whose brand is written in lower
 * case would see it raised. So a template with `{{tokens}}` is cased with the
 * tokens masked, and the values are put back exactly as they arrived.
 *
 * ── "AS WRITTEN" ───────────────────────────────────────────────────────────
 *
 * A tenant can switch the standard off (Website › Theme › Label
 * capitalisation). It is on for every tenant by default; `setLabelCase`
 * applies the theme's choice and re-renders.
 */
import type { i18n as I18n, PostProcessorModule } from "i18next";
import { titleCase } from "@praxis/shared/text/title-case";
import { LABEL_KEYS } from "./label-keys.generated";

export type LabelCase = "TITLE" | "AS_WRITTEN";

/** Section → every key in it (`true`) or the LABEL keys below it. */
const LABELS = new Map<string, true | Set<string>>();

/**
 * Add a set of LABEL keys. The website's are registered here; the portal's
 * ride the portal chunk and are registered by `portal-i18n.ts`, so a visitor
 * who never signs in never downloads them.
 */
export function registerLabelKeys(map: Readonly<Record<string, true | readonly string[]>>): void {
  for (const [section, keys] of Object.entries(map)) {
    if (keys === true) {
      LABELS.set(section, true);
      continue;
    }
    const have = LABELS.get(section);
    if (have === true) continue;
    const set = have || new Set<string>();
    for (const k of keys) set.add(k);
    LABELS.set(section, set);
  }
}
registerLabelKeys(LABEL_KEYS);

/** A key to its section and the rest (an array index as *), e.g. site.quote.steps.2.t to site.quote + steps.*.t — the same split the list uses. */
function split(key: string): [string, string] {
  const parts = key.replace(/\.\d+(?=\.|$)/g, ".*").split(".");
  return parts.length > 2
    ? [parts.slice(0, 2).join("."), parts.slice(2).join(".")]
    : [parts[0], parts.slice(1).join(".")];
}

/** Is this dictionary key a LABEL? Only `site.*` and `portal.*` ever are. */
export function isLabelKey(key: string): boolean {
  if (!/^(site|portal)\./.test(key)) return false;
  const [section, rel] = split(key);
  const entry = LABELS.get(section);
  return entry === true || (!!entry && entry.has(rel));
}

/** A key that finishes a split headline ("The People Behind" + "the Freight"). */
const CONTINUES = /\.(titleAccent|taglineAccent)$/;

let mode: LabelCase = "TITLE";

export const getLabelCase = (): LabelCase => mode;

/**
 * Apply the tenant's choice. Anything but "AS_WRITTEN" is the standard — an
 * older server, a cached theme from before the setting, a typo — because the
 * owner made Title Case the default for every tenant.
 */
export function setLabelCase(next: unknown, i18n?: I18n): void {
  const value: LabelCase = next === "AS_WRITTEN" ? "AS_WRITTEN" : "TITLE";
  if (value === mode) return;
  mode = value;
  // `useTranslation` re-renders on `languageChanged`; the same nudge
  // `applySiteCopy` gives after it changes the store.
  if (i18n) i18n.emit("languageChanged", i18n.language);
}

const langOf = (lng: unknown): "en" | "fr" => (String(lng || "").startsWith("fr") ? "fr" : "en");

/**
 * Title-case one label (when the standard is on). `continues` is for the
 * second half of a split headline: its first word is the middle of a phrase,
 * so "the freight" becomes "the Freight", not "The Freight".
 */
export function caseLabel(text: string, lang: string, { continues = false } = {}): string {
  if (mode !== "TITLE" || !text) return text;
  const l = langOf(lang);
  // A throwaway first word makes the real first word a mid-phrase word.
  return continues ? titleCase(`x ${text}`, l).slice(2) : titleCase(text, l);
}

const TOKEN = /\{\{[^}]*\}\}/g;
/* A stand-in for a token while the template is cased: no lower-case letter
   for `titleCase` to raise, and not a small word for it to lower. */
const mask = (i: number) => `T${i}`;
const MASKED = /T(\d+)/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Case a finished string whose template had `{{tokens}}` — the template's
 * words only. The template is matched against the finished string to recover
 * what each token became; when it cannot be (a nested `$t`, a formatter that
 * rewrote the text), the string is left exactly as i18next produced it.
 */
export function caseInterpolated(value: string, template: string, lang: string, continues = false): string {
  const tokens = template.match(TOKEN);
  if (!tokens) return caseLabel(value, lang, { continues });
  const literals = template.split(TOKEN);
  const shape = new RegExp(`^${literals.map(escapeRe).join("([\\s\\S]*?)")}$`);
  const found = shape.exec(value);
  if (!found) return value;
  let i = 0;
  const masked = template.replace(TOKEN, () => mask(i++));
  const cased = caseLabel(masked, lang, { continues });
  return cased.replace(MASKED, (_m, n) => found[Number(n) + 1] ?? "");
}

type Resolved = { i18nResolved?: { res?: unknown; usedKey?: string } };

/**
 * THE post-processor. Registered once, in `lib/i18n.ts`, for every `t()`.
 * `postProcessPassResolved` hands it the template the string came from.
 */
export const labelCasePostProcessor: PostProcessorModule = {
  type: "postProcessor",
  name: "labelCase",
  process(value: string, keys: string | string[], options: Record<string, unknown> & Resolved, translator: unknown) {
    if (mode !== "TITLE" || typeof value !== "string" || !value) return value;
    const key = options?.i18nResolved?.usedKey || (Array.isArray(keys) ? keys[0] : keys);
    if (typeof key !== "string" || !isLabelKey(key)) return value;
    const lng = (options?.lng as string | undefined) || (translator as { language?: string } | null)?.language || "en";
    const template = options?.i18nResolved?.res;
    const continues = CONTINUES.test(key);
    return typeof template === "string" && template.includes("{{")
      ? caseInterpolated(value, template, lng, continues)
      : caseLabel(value, lng, { continues });
  },
};
