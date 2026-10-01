/**
 * Is this page open inside another app's built-in browser — WhatsApp,
 * Facebook / Messenger, Instagram, Telegram, LinkedIn? (Tenant review of
 * 29 Sep 2026, item 1.9.)
 *
 * Those webviews cannot install a web app: there is no `beforeinstallprompt`,
 * no Add to Home Screen, and a push permission they grant dies with the
 * webview. The MD's colleagues are sent the app's link on WhatsApp, and the
 * link opens in WhatsApp's browser, where "install" can only fail — he had to
 * be told, in the meeting, to open it in Chrome. So the sign-in and install
 * surfaces say so, and offer the way out: an `intent:` URL naming Chrome on
 * Android (lib/installed-window.ts `browserUrlFor`, the same hand-off the
 * open-in-browser bar uses), the Safari steps on an iPhone.
 *
 * A second copy lives in client/src/lib/in-app-browser.ts — the two apps
 * share no runtime package for UI code (see installed-window.ts); keep them in
 * step.
 */

export type InAppBrowser = "WhatsApp" | "Facebook" | "Messenger" | "Instagram" | "Telegram" | "LinkedIn";

/** Each app's own marker in its webview's user agent. Order matters: Messenger before Facebook. */
const MARKERS: [InAppBrowser, RegExp][] = [
  ["WhatsApp", /\bWhatsApp\b/i],
  ["Messenger", /\bFB_IAB\/MESSENGER\b|\bFBAN\/Messenger|\bMessengerForiOS\b|\bOrca-Android\b/i],
  ["Instagram", /\bInstagram\b/i],
  ["Facebook", /\bFBAN\/|\bFBAV\/|\bFB_IAB\b|\bFBIOS\b|\[FB/i],
  ["Telegram", /\bTelegram\b|\bTelegramBot\b/i],
  ["LinkedIn", /\bLinkedInApp\b/i],
];

/** The app whose built-in browser this is, or null for a real browser. */
export function inAppBrowser(userAgent: string | null | undefined = typeof navigator !== "undefined" ? navigator.userAgent : ""): InAppBrowser | null {
  const ua = String(userAgent || "");
  if (!ua) return null;
  for (const [name, re] of MARKERS) if (re.test(ua)) return name;
  return null;
}

export const isAndroidUa = (ua: string) => /Android/i.test(ua);
export const isIosUa = (ua: string) => /iPhone|iPad|iPod/i.test(ua);
