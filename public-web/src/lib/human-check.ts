/**
 * The Cloudflare Turnstile token each protected form is holding, by form.
 *
 * Kept tiny and free of the widget on purpose: `api.ts` imports this so a POST
 * can carry the token in `X-Turnstile-Token`, and `api.ts` is in every visitor's
 * first download. The widget itself (`components/site/human-check.tsx`) loads
 * only on a page with a protected form, and only for a tenant with keys.
 *
 * A token is single use. `take` hands it to one request and forgets it, and
 * tells the widget, which fetches a fresh one for a second attempt. Without
 * that a visitor who mistyped their email would be refused on the retry for a
 * reason they cannot see.
 */

export type HumanAction = "message" | "contact" | "quote" | "careers";

const tokens = new Map<HumanAction, string>();
const listeners = new Map<HumanAction, Set<() => void>>();

/** The widget reports a fresh token (or null when it expired). */
export function setHumanToken(action: HumanAction, token: string | null): void {
  if (token) tokens.set(action, token);
  else tokens.delete(action);
}

export function hasHumanToken(action: HumanAction): boolean {
  return tokens.has(action);
}

/** Hand the token to one request, and ask the widget for the next one. */
export function takeHumanToken(action: HumanAction): string | null {
  const token = tokens.get(action) || null;
  tokens.delete(action);
  if (token) listeners.get(action)?.forEach((fn) => fn());
  return token;
}

/** The widget's "your token was used" subscription. */
export function onHumanTokenTaken(action: HumanAction, fn: () => void): () => void {
  if (!listeners.has(action)) listeners.set(action, new Set());
  listeners.get(action)!.add(fn);
  return () => {
    listeners.get(action)?.delete(fn);
  };
}

export const HUMAN_HEADER = "X-Turnstile-Token";

/** Whether a failed request was refused by the bot check, so the form can say so. */
export const isHumanCheckCode = (code: string | undefined | null): boolean =>
  code === "HUMAN_CHECK_REQUIRED" || code === "HUMAN_CHECK_FAILED";
