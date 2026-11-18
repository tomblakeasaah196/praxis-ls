/**
 * The words the quotation screens share (doc/SALES_CRM_LEAN_REVAMP_GUIDE.md
 * §3.4, §3.5): status labels, the fixed section library's titles, the two
 * outputs and the three languages. Four screens draw them (the list, the
 * editor, the templates screen and the Lead 360's Quotations tab), and §5 of
 * the frontend guide forbids a raw code on screen: a declined quotation reads
 * "Declined", never REJECTED.
 */
import { quotation as shared, type QuotationLanguage, type QuotationOutput, type QuotationSectionKey } from "@shared";
import { tr } from "@/lib/i18n";
import type { Tone } from "@/components/ui/pill";

/** §3.4 "Statuses": the proposal's IN_REVIEW is not carried over. */
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  REJECTED: "Declined",
  EXPIRED: "Expired",
  CONVERTED: "Invoiced",
};
const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "mute",
  SENT: "blue",
  ACCEPTED: "ok",
  REJECTED: "bad",
  EXPIRED: "warn",
  CONVERTED: "ok",
};
export const statusLabel = (s: string | null | undefined) => tr(STATUS_LABEL[String(s || "DRAFT")] || String(s || ""));
export const statusTone = (s: string | null | undefined): Tone => STATUS_TONE[String(s || "DRAFT")] || "mute";

/** The list's chips (§3.4): All, Draft, Sent, Accepted, Declined, Expired. */
export const STATUS_CHIPS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "SENT", label: "Sent" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "REJECTED", label: "Declined" },
  { value: "EXPIRED", label: "Expired" },
] as const;

/** The fixed library, in its fixed print order (D8). */
export const SECTION_KEYS = shared.SECTION_KEYS;
export const SECTION_TITLE: Record<QuotationSectionKey, string> = {
  cover: "Cover",
  about_us: "About Us",
  needs: "Your Needs",
  solution: "Our Solution",
  scope: "Scope of Services",
  pricing: "Pricing",
  terms: "Terms",
  case_stories: "Case Stories",
  next_steps: "Next Steps",
};
export const sectionTitle = (k: QuotationSectionKey) => tr(SECTION_TITLE[k]);

/** Sections whose words a person writes on the quotation, and those a template carries words for. */
export const TEXT_SECTIONS = shared.TEXT_SECTIONS;
export const TEMPLATE_TEXT_SECTIONS = shared.TEMPLATE_TEXT_SECTIONS;
export const EXTRACT_SECTIONS = shared.EXTRACT_SECTIONS;
export const ALWAYS_ON = shared.ALWAYS_ON;
/** The two a person may ask the AI to draft (§3.4). */
export const AI_SECTIONS: readonly QuotationSectionKey[] = ["needs", "solution"];

export const OUTPUT_OPTIONS: { value: QuotationOutput; label: string }[] = [
  { value: "FULL", label: "Full Proposal" },
  { value: "EXTRACT", label: "Commercial Extract" },
];
export const outputLabel = (o: QuotationOutput | string | null | undefined) => tr(o === "EXTRACT" ? "Commercial Extract" : "Full Proposal");

export const LANGUAGE_OPTIONS: { value: QuotationLanguage; label: string }[] = [
  { value: "EN", label: "EN" },
  { value: "FR", label: "FR" },
  { value: "BILINGUAL", label: "Both" },
];

/**
 * Which sections print for an output (the server's `printedKeys`, mirrored so
 * the editor can mark them): a Full Proposal prints what is on; a Commercial
 * Extract prints the cover, Pricing, Terms and Next Steps. Pricing always.
 * Nothing here reads a number: the switch never changes one.
 */
export function printedSections(output: QuotationOutput, enabled: (k: QuotationSectionKey) => boolean): QuotationSectionKey[] {
  const allowed: readonly QuotationSectionKey[] = output === "EXTRACT" ? EXTRACT_SECTIONS : SECTION_KEYS;
  return SECTION_KEYS.filter((k) => allowed.includes(k) && (ALWAYS_ON.includes(k) || enabled(k)));
}
