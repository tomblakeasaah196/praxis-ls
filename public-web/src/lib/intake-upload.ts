/**
 * Sending a website message or contact enquiry WITH files, with upload
 * progress (SmartLS website v2, PR 2).
 *
 * `fetch` still reports no upload progress, and 20 MB of base64 on a phone
 * connection is long enough that a silent button reads as a frozen screen and
 * people send twice. So a request that carries files goes through an
 * XMLHttpRequest here: 0 to 99 % while the bytes go up, 100 only once the
 * SERVER has answered. Same envelope, same errors, and the same bot-check
 * header as `publicApi`. Without files it is `publicApi`'s ordinary call.
 *
 * Its own file, like `quote-intake.ts`, so only the two forms that attach
 * files download it.
 */
import { buildUrl, PublicApiError, type FieldErrors } from "./api";
import { tStatic } from "./i18n";
import { HUMAN_HEADER, takeHumanToken } from "./human-check";
import {
  cleanIntake,
  contactEnquiries,
  HUMAN_ACTION_FOR,
  websiteMessages,
  type ContactEnquiry,
  type IntakeReceipt,
  type WebsiteMessage,
} from "./intake-api";

function postWithProgress<T>(
  path: keyof typeof HUMAN_ACTION_FOR,
  body: unknown,
  onProgress: (pct: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", buildUrl(path));
    xhr.setRequestHeader("Content-Type", "application/json");
    const token = takeHumanToken(HUMAN_ACTION_FOR[path]);
    if (token) xhr.setRequestHeader(HUMAN_HEADER, token);
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

export function sendWebsiteMessage(
  body: WebsiteMessage,
  startedAt: number | undefined,
  onProgress: (pct: number) => void,
): Promise<IntakeReceipt> {
  if (!body.documents?.length) return websiteMessages.send(body, startedAt);
  return postWithProgress<IntakeReceipt>(websiteMessages.path, cleanIntake(body, startedAt), onProgress);
}

export function sendContactEnquiry(
  body: ContactEnquiry,
  startedAt: number | undefined,
  onProgress: (pct: number) => void,
): Promise<IntakeReceipt> {
  if (!body.documents?.length) return contactEnquiries.send(body, startedAt);
  return postWithProgress<IntakeReceipt>(contactEnquiries.path, cleanIntake(body, startedAt), onProgress);
}
