/**
 * Sharing a client's portal sign-in link by hand (tenant review of 29 Sep
 * 2026, item 1.8, D4): the link carries the person's email and no token, the
 * message is in the person's language, and wa.me gets their mobile when known.
 */
import { describe, it, expect } from "vitest";
import { isSafeSignInUrl, signInMessage, waNumber, whatsappUrl } from "./share-sign-in";

const URL_OK = "https://smartls.praxis-ls.com/portal/login?email=elisha%40goum.cm";

describe("the sign-in link", () => {
  it("is the sign-in page with an email, and nothing that signs anyone in", () => {
    expect(isSafeSignInUrl(URL_OK)).toBe(true);
    expect(isSafeSignInUrl("https://smartls.praxis-ls.com/portal/set-password?token=abc")).toBe(false);
    expect(isSafeSignInUrl(`${URL_OK}&token=abc`)).toBe(false);
    expect(isSafeSignInUrl("not a url")).toBe(false);
  });
});

describe("the message", () => {
  it("is written in the person's language", () => {
    const fr = signInMessage({ language: "fr", name: "Elisha Godwin", tenant: "SMART LS", url: URL_OK });
    expect(fr).toMatch(/^Bonjour Elisha,/);
    expect(fr).toContain(URL_OK);
    expect(fr).toMatch(/code à 6 chiffres/);
    const en = signInMessage({ language: "en", name: "", tenant: "SMART LS", url: URL_OK });
    expect(en).toMatch(/^Hello,/);
    expect(en).toContain("SMART LS client portal");
  });
});

describe("WhatsApp", () => {
  it("opens the person's chat when there is a mobile, else WhatsApp's own picker", () => {
    expect(waNumber("+237 6 77 12 34 56")).toBe("237677123456");
    expect(waNumber("1234")).toBeNull();
    expect(whatsappUrl("+237 677 12 34 56", "hi there")).toBe("https://wa.me/237677123456?text=hi%20there");
    expect(whatsappUrl(null, "hi")).toBe("https://wa.me/?text=hi");
  });
});
