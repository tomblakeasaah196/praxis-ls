/**
 * `trc()` — the escape hatch for one English word with two meanings.
 *
 * The defect it exists for is live in the tree: `strings."Open"` is "Ouvrir",
 * the verb, because that is what every button rendering it means — and the same
 * key is rendered as the LABEL OF A COUNT on at least three stat tiles, where
 * French needs "Ouvert". Analytics would have made it four.
 */
import { describe, it, expect, afterEach } from "vitest";
import i18n, { tr, trc, setLang } from "./i18n";

describe("trc", () => {
  afterEach(() => {
    void i18n.changeLanguage("en");
  });

  it("gives the verb and the adjective different French for the same English", () => {
    setLang("fr");
    expect(tr("Open")).toBe("Ouvrir");
    expect(trc("Open", "state")).toBe("Ouvert");
  });

  it("renders the same English either way, so the source still reads as the copy", () => {
    setLang("en");
    expect(tr("Open")).toBe("Open");
    expect(trc("Open", "state")).toBe("Open");
  });

  it("FALLS BACK TO tr() for a context nothing has translated", () => {
    // This is what makes adding a context safe: a screen that asks for one the
    // dictionary has never heard of gets the ordinary translation, not a blank
    // and not the raw `Word_context` key.
    setLang("fr");
    expect(trc("Open", "nonesuch")).toBe("Ouvrir");
    expect(trc("Overdue", "state")).toBe(tr("Overdue"));
  });

  it("falls back to the English for a word that is in no dictionary", () => {
    setLang("fr");
    expect(trc("Spline reticulation", "state")).toBe("Spline reticulation");
  });
});
