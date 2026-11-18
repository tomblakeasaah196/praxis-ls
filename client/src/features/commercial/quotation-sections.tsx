/**
 * The quotation's sections, under its lines (lean revamp §3.4 "then the
 * sections", owner decision D8).
 *
 * The fixed library in its fixed order, each with its on/off switch:
 *
 *   Cover, Next Steps   automatic, nothing to write
 *   About Us            the published Company Profile, read-only here, with a
 *                       link to where it is written
 *   Your Needs          words, EN | FR, Draft With AI
 *   Our Solution        words, EN | FR, Draft With AI
 *   Scope of Services   words, EN | FR
 *   Pricing             the lines above; always on, no switch
 *   Terms               words, EN | FR (validity and payment terms print too)
 *   Case Stories        on or off
 *
 * Words are saved when the box is left, one section at a time, so two people
 * editing different sections never overwrite each other's words.
 */
import * as React from "react";
import type { QuotationOutput, QuotationSectionInput, QuotationSectionKey } from "@shared";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { InfoHint } from "@/components/ui/info-hint";
import { AccessLink } from "@/components/ui/access-link";
import { cn } from "@/lib/cn";
import type { QuotationSection } from "@/lib/quotation-api";
import { AI_SECTIONS, ALWAYS_ON, SECTION_KEYS, TEXT_SECTIONS, printedSections, sectionTitle } from "./quotation-words";

const AUTOMATIC: readonly QuotationSectionKey[] = ["cover", "next_steps", "pricing"];

/** What an automatic section prints, behind its ⓘ. */
const ABOUT: Partial<Record<QuotationSectionKey, string>> = {
  cover: "Your branding, the client, the title, the reference and the date.",
  about_us: "The published Company Profile, pinned when the quotation is sent.",
  pricing: "The lines above, with their totals.",
  terms: "The validity and payment terms print with these words.",
  case_stories: "Up to three published Success Stories, named only with the client's consent.",
  next_steps: "How to accept, and who to contact.",
};

/** One text box per language, saved when it is left. */
export function BilingualText({
  sectionKey,
  en,
  fr,
  readOnly,
  onSave,
}: {
  sectionKey: string;
  en: string | null | undefined;
  fr: string | null | undefined;
  readOnly: boolean;
  onSave: (lang: "en" | "fr", text: string) => void;
}) {
  const [tab, setTab] = React.useState<"EN" | "FR">("EN");
  const [draft, setDraft] = React.useState({ en: en || "", fr: fr || "" });
  // Re-sync with what is stored (a Draft With AI, a reload), never while typing.
  React.useEffect(() => setDraft((d) => ({ ...d, en: en || "" })), [en]);
  React.useEffect(() => setDraft((d) => ({ ...d, fr: fr || "" })), [fr]);
  const box = (lang: "en" | "fr") => (
    <Textarea
      rows={5}
      aria-label={`${tr(sectionTitleOf(sectionKey))} ${lang.toUpperCase()}`}
      value={draft[lang]}
      readOnly={readOnly}
      lang={lang}
      onChange={(e) => setDraft((d) => ({ ...d, [lang]: e.target.value }))}
      onBlur={() => {
        if (!readOnly && draft[lang] !== ((lang === "en" ? en : fr) || "")) onSave(lang, draft[lang]);
      }}
    />
  );
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as "EN" | "FR")}
      label={`${tr(sectionTitleOf(sectionKey))} ${tr("language")}`}
      listClassName="mb-2"
      tabs={[
        { value: "EN", label: "EN", content: box("en") },
        { value: "FR", label: "FR", content: box("fr") },
      ]}
    />
  );
}

const sectionTitleOf = (k: string) => (SECTION_KEYS as readonly string[]).includes(k) ? sectionTitle(k as QuotationSectionKey) : k;

export function SectionsEditor({
  sections,
  output,
  readOnly,
  onSave,
  onDraftAi,
  drafting,
}: {
  sections: QuotationSection[];
  output: QuotationOutput;
  readOnly: boolean;
  onSave: (patch: QuotationSectionInput) => void;
  onDraftAi: ((key: QuotationSectionKey) => void) | null;
  drafting: QuotationSectionKey | null;
}) {
  const byKey = new Map(sections.map((s) => [s.section_key, s]));
  const enabled = (k: QuotationSectionKey) => byKey.get(k)?.enabled !== false;
  const printed = new Set(printedSections(output, enabled));
  return (
    <ul className="space-y-2">
      {SECTION_KEYS.map((key) => {
        const s = byKey.get(key);
        const on = ALWAYS_ON.includes(key) || enabled(key);
        const title = sectionTitle(key);
        const writes = TEXT_SECTIONS.includes(key);
        return (
          <li key={key} className={cn("rounded-lg border p-3", !printed.has(key) && "bg-muted/30")}>
            <div className="flex flex-wrap items-center gap-2">
              {ALWAYS_ON.includes(key) ? (
                <span className="w-5 shrink-0" aria-hidden="true" />
              ) : (
                <Checkbox
                  checked={on}
                  disabled={readOnly}
                  label={<span className="sr-only">{`${tr("Print")} ${title}`}</span>}
                  onCheckedChange={(v) => onSave({ section_key: key, enabled: v })}
                />
              )}
              <h3 className={cn("text-sm font-semibold", !on && "text-muted-foreground")}>{title}</h3>
              {ABOUT[key] ? <InfoHint label={`${tr("About")} ${title}`}>{tr(ABOUT[key] as string)}</InfoHint> : null}
              {ALWAYS_ON.includes(key) ? <Pill tone="mute">{tr("Always On")}</Pill> : AUTOMATIC.includes(key) ? <Pill tone="mute">{tr("Automatic")}</Pill> : null}
              {on && !printed.has(key) ? <Pill tone="mute">{tr("Not in the Extract")}</Pill> : null}
              <span className="ml-auto flex items-center gap-2">
                {key === "about_us" ? (
                  <AccessLink to="/sales/company-profile" className="text-xs text-primary-ink underline">
                    {tr("Open Company Profile")}
                  </AccessLink>
                ) : null}
                {onDraftAi && !readOnly && AI_SECTIONS.includes(key) ? (
                  <Button size="sm" variant="outline" loading={drafting === key} disabled={drafting !== null} onClick={() => onDraftAi(key)}>
                    {tr("Draft With AI")}
                  </Button>
                ) : null}
              </span>
            </div>
            {writes && on ? (
              <div className="mt-2">
                <BilingualText
                  sectionKey={key}
                  en={s?.body_en}
                  fr={s?.body_fr}
                  readOnly={readOnly}
                  onSave={(lang, text) => onSave({ section_key: key, [lang === "en" ? "body_en" : "body_fr"]: text.trim() ? text : null })}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
