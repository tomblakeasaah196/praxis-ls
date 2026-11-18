/**
 * A shared quotation: `/api/tenant/public/quotations/:token`
 * (src/modules/commercial/quotation_public, lean revamp §3.4 "The link").
 *
 * The token in the URL is the ONLY credential: a random value minted when the
 * quotation was sent, stored server side only as a hash. Unknown, revoked,
 * expired-link and draft all answer the same 404. A proposal link from before
 * the revamp is a token too (14542 carried them onto the migrated quotation),
 * so it reads here unchanged.
 *
 * The server sends the ONE render (`html`), the same HTML the PDF prints, so
 * this app formats nothing in the document: the page and the download cannot
 * disagree. What it adds is the furniture around it and the two answers.
 */
import { publicApi, publicGet } from "./api";

export type QuotationLang = "EN" | "FR";
export type QuotationStatus = "SENT" | "ACCEPTED" | "CONVERTED" | "REJECTED" | "EXPIRED";
export type SignCard = { preset_code: "STAMP" | "DRAWN"; label: string; blurb: string | null };
export type QuotationSignature = {
  signer_name: string;
  signer_role: string | null;
  signed_at: string;
  mark: string;
  assurance: string;
  verify_code: string | null;
};

export type PublicQuotation = {
  quotation: {
    doc_number: string | null;
    title: string | null;
    status: QuotationStatus;
    output: "FULL" | "EXTRACT";
    version: number;
    currency: string;
    valid_until: string | null;
    sent_at: string | null;
    answered_at: string | null;
    decline_reason: string | null;
    totals: { ht: number; vat: number; ttc: number } | null;
    party: { name: string } | null;
  };
  language: QuotationLang;
  languages: QuotationLang[];
  html: string;
  signature: QuotationSignature | null;
  /** SENT and in date: the only state that takes an answer. */
  open: boolean;
  signing: { available: boolean; cards: SignCard[] };
  decline_reasons: { reason_code: string; label: string }[];
};

export type SigningStart = {
  signer: { full_name: string; email_masked: string };
  cards: SignCard[];
  otp: unknown;
};

const base = (token: string) => `/public/quotations/${encodeURIComponent(token)}`;
const q = (lang: QuotationLang) => ({ query: { lang } });

export const getQuotation = (token: string, lang: QuotationLang | null) =>
  publicGet<PublicQuotation>(base(token), lang ? q(lang) : undefined);

/** A link, not a fetch: the server streams the PDF with a Content-Disposition,
 *  so an `<a>` is what lets the reader keep the file. */
export const quotationPdfUrl = (token: string, lang: QuotationLang) =>
  `/api/tenant${base(token)}/pdf?lang=${lang}`;

/** Accept, step 1: name and role; the code goes to the address it was sent to. */
export const startAccept = (token: string, lang: QuotationLang, body: { full_name: string; role: string | null }) =>
  publicApi<SigningStart>(`${base(token)}/accept/start`, { method: "POST", body, ...q(lang) });

export const resendCode = (token: string, lang: QuotationLang) =>
  publicApi<{ otp: unknown }>(`${base(token)}/accept/resend`, { method: "POST", body: {}, ...q(lang) });

/** Accept, step 2: the code and the stamp or the drawn mark. */
export const completeAccept = (
  token: string,
  lang: QuotationLang,
  body: { code: string; preset_code: "STAMP" | "DRAWN"; full_name: string; role: string | null; mark_image_b64?: string },
) => publicApi<{ accepted: boolean; signature: QuotationSignature | null }>(`${base(token)}/accept/complete`, { method: "POST", body, ...q(lang) });

/** Accept by name only: where the tenant offers no e-signature. */
export const confirmAccept = (token: string, lang: QuotationLang, body: { full_name: string; role: string | null }) =>
  publicApi<{ accepted: boolean }>(`${base(token)}/accept`, { method: "POST", body, ...q(lang) });

export const declineQuotation = (token: string, lang: QuotationLang, body: { reason_code: string; note: string | null }) =>
  publicApi<{ declined: boolean }>(`${base(token)}/decline`, { method: "POST", body, ...q(lang) });
