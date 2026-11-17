/**
 * Which signature templates are LAYOUTS a company can choose between, and which
 * one is in force.
 *
 * Apart from `templates-tab.tsx`, which draws the choice, because a file that
 * exports functions beside a component loses fast refresh.
 */
import type { SignatureTemplate } from "@/lib/mail-api";

/** Seeded per-department copies of the classic layout: aliases, not layouts. */
const DEPARTMENT_ALIAS = /^smartls_classic_/;

/** The layouts a company can choose between. */
export function companyLayouts(templates: SignatureTemplate[]): SignatureTemplate[] {
  return templates.filter((t) => t.is_active && !DEPARTMENT_ALIAS.test(t.key));
}

/** The one in force: the company-wide default. */
export function companyLayout(templates: SignatureTemplate[]): SignatureTemplate | null {
  return templates.find((t) => t.is_active && t.is_default && t.scope_kind === "TENANT") || null;
}
