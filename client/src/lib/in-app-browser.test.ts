/**
 * Which app's built-in browser is this (tenant review of 29 Sep 2026, item
 * 1.9)? Real user agents from each webview, and the real browsers that must
 * NOT be mistaken for one.
 */
import { describe, it, expect } from "vitest";
import { inAppBrowser, isAndroidUa, isIosUa } from "./in-app-browser";

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1";

describe("inAppBrowser", () => {
  it("names each app's webview", () => {
    expect(inAppBrowser(`${ANDROID_CHROME} WhatsApp/2.24.19.86`)).toBe("WhatsApp");
    expect(inAppBrowser(`${ANDROID_CHROME} [FB_IAB/FB4A;FBAV/480.0.0.0;]`)).toBe("Facebook");
    expect(inAppBrowser(`${ANDROID_CHROME} [FB_IAB/MESSENGER;FBAV/470.0.0.0;]`)).toBe("Messenger");
    expect(inAppBrowser(`${IOS_SAFARI} Instagram 350.0.0.0 (iPhone14,5; iOS 17_6)`)).toBe("Instagram");
    expect(inAppBrowser(`${ANDROID_CHROME} Telegram-Android/11.1.3`)).toBe("Telegram");
    expect(inAppBrowser(`${IOS_SAFARI} LinkedInApp/9.30`)).toBe("LinkedIn");
  });

  it("leaves real browsers alone", () => {
    expect(inAppBrowser(ANDROID_CHROME)).toBeNull();
    expect(inAppBrowser(IOS_SAFARI)).toBeNull();
    expect(inAppBrowser("")).toBeNull();
  });

  it("tells Android from iOS for the way out", () => {
    expect(isAndroidUa(ANDROID_CHROME)).toBe(true);
    expect(isIosUa(IOS_SAFARI)).toBe(true);
    expect(isIosUa(ANDROID_CHROME)).toBe(false);
  });
});
