/**
 * Sending a website quote request WITH its documents (tenant review, meeting 6,
 * PR 2) — the one intake call that needs upload progress.
 *
 * ── WHY THIS IS NOT IN `api.ts` OR `intake-api.ts` ────────────────────────
 *
 * Both are on the first-paint path: the footer's newsletter form imports
 * `intake-api.ts`, and everything imports `api.ts`. An XMLHttpRequest wrapper
 * that only the quote wizard ever calls would be downloaded by every visitor
 * to every page — the cost `check-bundle.mjs` exists to refuse. Only the quote
 * wizard imports this file, so it travels in the quote chunk.
 */
import { buildUrl, PublicApiError, type FieldErrors } from "./api";
import { tStatic } from "./i18n";
import { cleanIntake, quoteRequests, type IntakeReceipt, type QuoteRequest } from "./intake-api";

/**
 * A JSON POST that reports how much of its body has left the browser.
 *
 * `fetch` still has no upload progress, and a quote request carrying three
 * scanned documents is several megabytes of base64 on a phone connection —
 * long enough that a silent button reads as a frozen screen and people send it
 * twice (CLAUDE.md, uploads: every upload shows 0→100 %). Same answer, errors
 * and envelope as `publicApi`; `onProgress` gets 0–99 while bytes go up and
 * 100 only once the SERVER has answered.
 */
function publicPostWithProgress<T = unknown>(
  path: string,
  body: unknown,
  onProgress: (pct: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", buildUrl(path));
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onerror = () => reject(new PublicApiError("NETWORK_ERROR", tStatic("errors.network"), 0));
    xhr.onload = () => {
      const requestId = xhr.getResponseHeader("X-Request-Id");
      let json: unknown = null;
      if (xhr.responseText) {
        try {
          json = JSON.parse(xhr.responseText);
        } catch {
          reject(new PublicApiError("BAD_RESPONSE", tStatic("errors.badResponse"), xhr.status, undefined, requestId));
          return;
        }
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const err =
          json && typeof json === "object" && "error" in json
            ? (json as { error?: { code?: string; message?: string; fields?: FieldErrors } }).error
            : undefined;
        reject(new PublicApiError(err?.code || "ERROR", err?.message || xhr.statusText || "Request failed", xhr.status, err?.fields, requestId));
        return;
      }
      onProgress(100);
      resolve(json && typeof json === "object" && "data" in json ? (json as { data: T }).data : (json as T));
    };
    xhr.send(JSON.stringify(body));
  });
}

/**
 * Send a quote request. With documents, `onProgress` reports the upload —
 * the body is then megabytes of base64 on a phone connection; without, it is
 * the same call `quoteRequests.send` makes.
 */
export function sendQuoteRequest(
  body: QuoteRequest,
  startedAt: number | undefined,
  onProgress?: (pct: number) => void,
): Promise<IntakeReceipt> {
  if (!onProgress || !body.documents || !body.documents.length) return quoteRequests.send(body, startedAt);
  return publicPostWithProgress<IntakeReceipt>(quoteRequests.path, cleanIntake(body, startedAt), onProgress);
}
