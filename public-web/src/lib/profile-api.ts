/**
 * A shared Company Profile — `GET /api/tenant/public/company-profile/:token`.
 *
 * The token in the URL is the only credential: a random value the desk minted
 * for one recipient, stored server side only as a hash.
 *
 * The server sends a PRESENTATION: section titles, sentences and figures
 * already in the reader's language and already formatted, built by the same
 * function the PDF is printed from. This page formats nothing, so the page and
 * the PDF cannot disagree. Hidden items never reach it.
 */
import { publicGet } from "./api";

export type ProfileSection =
  | { key: "who_we_are"; title: string; paragraphs: { key: string; label: string | null; body: string }[] }
  | { key: "services"; title: string; items: { name: string; sentence: string | null }[] }
  | { key: "capacity"; title: string; figures: { key: string; label: string; value: string; detail: string | null }[]; note: string | null }
  | { key: "certifications"; title: string; items: { name: string; kind: string }[] }
  | { key: "case_stories"; title: string; items: { title: string; client: string; summary: string | null; kpis: { label: string; value: string }[] }[] }
  | { key: "clients"; title: string; logos: { name: string; url: string }[] }
  | { key: "why_us"; title: string; items: { title: string | null; body: string | null }[] }
  | { key: "contact"; title: string; lines: { key: string; label: string; value: string; href: string | null }[] };

export type ProfilePresentation = {
  language: "EN" | "FR";
  title: string;
  version: { number: number; published_at: string | null } | null;
  company: { name: string; tagline: string | null; logo_url: string | null; cover_url: string | null };
  sections: ProfileSection[];
};

export const getProfile = (token: string, lang: "EN" | "FR") =>
  publicGet<{ presentation: ProfilePresentation }>(
    `/public/company-profile/${encodeURIComponent(token)}`,
    { query: { lang } },
  );

/** A link, not a fetch: the server streams the PDF with a Content-Disposition,
 *  so an `<a>` is what lets the reader keep the file. */
export const profilePdfUrl = (token: string, lang: "EN" | "FR") =>
  `/api/tenant/public/company-profile/${encodeURIComponent(token)}/pdf?lang=${lang}`;
