/**
 * The assistant that drafts a service page.
 *
 * The test that matters is the preservation guarantee. `structure` promises the
 * author's sentences come back byte for byte, and the only reason that promise
 * is keepable is that the model is never handed the prose — it returns heading
 * POSITIONS and `assembleStructured` copies the author's own paragraphs between
 * them. If someone later "simplifies" this by asking the model for the whole
 * document back, these fail, which is the point.
 */
"use strict";

const ai = require("../../src/modules/operations/service_type_web/service_type_web.ai_copy");

const PARAS = [
  "When a shipment is urgent, valuable or moving across borders, arranging a flight is only one part of the logistics.",
  "A successful international air shipment begins long before cargo reaches an airport.",
  "International air freight requires accurate documentation and compliance with applicable export requirements.",
  "When the aircraft arrives, the shipment still has important stages to complete.",
];

describe("assembleStructured — the preservation guarantee", () => {
  test("inserts headings without altering a single paragraph", () => {
    const out = ai.assembleStructured(PARAS, [
      { start_paragraph: 1, title: "From Origin Pickup to Airport" },
      { start_paragraph: 3, title: "Destination and Final Delivery" },
    ]);
    expect(out).toContain("## From Origin Pickup to Airport");
    expect(out).toContain("## Destination and Final Delivery");
    // Every original paragraph survives verbatim.
    for (const p of PARAS) expect(out).toContain(p);
    // And nothing else is prose: strip the headings and the body is the input.
    const back = out
      .split(/\n\s*\n/)
      .filter((b) => !/^##\s/.test(b.trim()))
      .map((b) => b.trim());
    expect(back).toEqual(PARAS);
  });

  test("a heading the model invented for a paragraph that does not exist is dropped", () => {
    const out = ai.assembleStructured(PARAS, [
      { start_paragraph: 99, title: "Nowhere" },
      { start_paragraph: -1, title: "Before the start" },
      { start_paragraph: 1, title: "Real" },
    ]);
    expect(out).not.toContain("Nowhere");
    expect(out).not.toContain("Before the start");
    expect(out).toContain("## Real");
  });

  test("two headings claiming the same paragraph keep the first, not both", () => {
    const out = ai.assembleStructured(PARAS, [
      { start_paragraph: 2, title: "First" },
      { start_paragraph: 2, title: "Second" },
    ]);
    expect(out).toContain("## First");
    expect(out).not.toContain("## Second");
  });

  test("markdown smuggled into a title is reduced to a plain heading", () => {
    const out = ai.assembleStructured(PARAS, [
      { start_paragraph: 1, title: "### Sneaky" },
    ]);
    expect(out).toContain("## Sneaky");
    expect(out).not.toContain("### Sneaky");
  });

  test("no sections at all returns the prose unchanged", () => {
    expect(ai.assembleStructured(PARAS, [])).toBe(PARAS.join("\n\n"));
    expect(ai.assembleStructured(PARAS, undefined)).toBe(PARAS.join("\n\n"));
  });
});

describe("stripStructure — re-running does not stack headings", () => {
  test("drops headings a previous run added, keeping the prose", () => {
    const structured = "## One\n\nBody one.\n\n## Two\n\nBody two.";
    expect(ai.stripStructure(structured)).toBe("Body one.\n\nBody two.");
  });
});

describe("clip", () => {
  test("cuts on a word boundary so a review panel never shows a severed word", () => {
    const out = ai.clip("international air freight coordination", 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).toBe("international air");
  });

  test("leaves anything already short enough exactly alone", () => {
    expect(ai.clip("Short enough", 100)).toBe("Short enough");
  });
});

describe("parseJson", () => {
  test("reads a fenced block", () => {
    expect(ai.parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  test("reads an object a model wrapped in a sentence", () => {
    expect(ai.parseJson('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
  });
  test("returns null rather than throwing on nonsense", () => {
    expect(ai.parseJson("not json at all")).toBeNull();
  });
});

describe("request schema", () => {
  test("a licence is required when working from existing copy", () => {
    expect(ai.schema.safeParse({ source: "existing" }).success).toBe(false);
    expect(ai.schema.safeParse({ source: "existing", licence: "structure" }).success).toBe(true);
  });

  test("drafting from scratch needs no licence — there is no prose to protect", () => {
    expect(ai.schema.safeParse({ source: "scratch" }).success).toBe(true);
  });

  test("tone defaults put operations and search first, marketing light", () => {
    const { data } = ai.schema.safeParse({ source: "scratch" });
    expect(data.tone).toEqual({
      operational: "strong",
      commercial: "light",
      seo: "strong",
      corridor: "light",
      plain: "strong",
    });
  });

  test("an unknown tone axis is refused rather than silently ignored", () => {
    const out = ai.schema.safeParse({
      source: "scratch",
      tone: { operational: "strong", vibes: "strong" },
    });
    expect(out.success).toBe(false);
  });

  test("the five axes are the ones the prompt can actually carry", () => {
    expect(Object.keys(ai.TONE_AXES)).toEqual([
      "operational",
      "commercial",
      "seo",
      "corridor",
      "plain",
    ]);
  });
});
