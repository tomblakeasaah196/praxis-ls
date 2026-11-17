/**
 * A sentence with a colon in it is translated like any other.
 *
 * `tr()` looks a translation up by its exact English text. i18next reads a
 * colon in a key as "namespace:key", so every sentence containing one was
 * looked up in a namespace that does not exist and came back in English, in
 * the French build, with nothing failing. The house rule for copy is to use a
 * colon where an em dash used to be, so these are common: the Client inbox's
 * own empty state was one (17 Nov 2026).
 */
import { afterEach, describe, expect, it } from "vitest";
import i18n, { navT, setLang, tr, tv } from "./i18n";
import { fr } from "./i18n-dict";

afterEach(() => {
  void i18n.changeLanguage("en");
});

describe("a sentence with a colon in it", () => {
  it("is French in French", () => {
    setLang("fr");
    expect(tr("Nothing waiting: every client has an answer")).toBe("Rien en attente: chaque client a une réponse");
  });

  it("is itself in English", () => {
    setLang("en");
    expect(tr("Nothing waiting: every client has an answer")).toBe("Nothing waiting: every client has an answer");
  });

  it("EVERY French entry whose English has a colon is reachable, not only the one above", () => {
    setLang("fr");
    const strings = (fr as unknown as { strings: Record<string, string> }).strings;
    const withColon = Object.keys(strings).filter((k) => k.includes(":") && !k.includes("{{"));
    // The defect was all of them at once, so the test is all of them at once.
    expect(withColon.length).toBeGreaterThan(20);
    const stuck = withColon.filter((k) => strings[k] !== k && tr(k) === k);
    expect(stuck).toEqual([]);
  });

  it("still fills its placeholders", () => {
    setLang("fr");
    const strings = (fr as unknown as { strings: Record<string, string> }).strings;
    const key = Object.keys(strings).find((k) => k.includes(": ") && k.includes("{{") && strings[k] !== k);
    // Only meaningful if the dictionary holds such an entry; it does today.
    if (!key) return;
    const names = [...key.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    const out = tv(key, Object.fromEntries(names.map((n) => [n, "7"])));
    expect(out).not.toBe(key);
    expect(out).not.toMatch(/\{\{/);
  });
});

describe("what a colon in a key must not have changed", () => {
  it("a sentence with full stops in it is still found", () => {
    setLang("fr");
    expect(tr("Transcripts are long; open it when you need it.")).toBe(
      "Les transcriptions sont longues ; ouvrez-la quand vous en avez besoin.",
    );
  });

  it("navigation labels and a string nobody translated behave as before", () => {
    setLang("fr");
    const t = i18n.t.bind(i18n) as unknown as (k: string, o?: { defaultValue?: string }) => string;
    expect(navT(t, "No such nav label")).toBe("No such nav label");
    expect(tr("A sentence: that nobody has translated")).toBe("A sentence: that nobody has translated");
  });
});
