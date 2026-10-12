/**
 * The contract body survives the editor.
 *
 * ── WHAT IS ACTUALLY AT RISK ───────────────────────────────────────────────
 *
 * `body_md` is markdown because the PDF renderer SPLITS ON `##` to decide what
 * an article is. Putting a rich text editor in front of it means every save now
 * passes the agreed text through a parse and a serialise. A heading that does
 * not come back is an article that silently merges into the one above it, on a
 * document somebody then signs, and nothing anywhere would fail.
 *
 * So the test that matters is not "does the editor work". It is: take the exact
 * markdown the clause library produces, open it, close it, and demand the same
 * bytes back.
 */
import { describe, it, expect } from "vitest";
import { mdToDoc, docToMd, isEmptyDoc } from "./contract-md";

/* VERBATIM output of `hr_contract.clauses`, pasted rather than paraphrased.
 * A fixture that merely resembles the library is a test that passes while the
 * real thing round-trips badly, which is the only failure mode that matters
 * here. Regenerate with:
 *
 *   node -e "const c=require('./src/modules/hr/hr_contract/hr_contract.clauses');…"
 *
 * `contract-clauses.test.js` on the backend holds the other half of this: that
 * the library never emits a construct this grammar cannot carry. */
const PARTIES_EN = `## Parties

This contract is made between Smart Logistics & Services Ltd, Douala, Cameroun, Trade register RC/DLA/2019/B/1234, CNPS employer number CM-55012 (the "Employer") of the one part and JBS Praxis, CNPS number CM-88231 (the "Employee") of the other part.

The parties agree as follows.`;

const DUTIES_EN = `## Engagement and Duties

Smart Logistics & Services Ltd engages the Employee as Chief of Operations in the Operations department, which the Employee accepts.

- Take charge of import operations end to end.
- Clear declarations at the Douala customs office.

This list is not exhaustive. The Employee shall carry out any task reasonably connected with the position and consistent with their classification.`;

const PARTIES_FR = `## Parties

Le présent contrat est conclu entre Smart Logistics & Services Ltd, Douala, Cameroun, RCCM RC/DLA/2019/B/1234, CNPS employeur CM-55012, ci-après « l'Employeur », d'une part, et JBS Praxis, CNPS CM-88231, ci-après « le Salarié », d'autre part.

Les parties conviennent de ce qui suit.`;

const PAY_FR = `## Rémunération

Le Salarié perçoit une rémunération brute mensuelle de 500\u00a0000 XAF, payable à terme échu au plus tard le dernier jour ouvrable du mois.

L'Employeur opère sur cette rémunération les retenues légales et conventionnelles, notamment la cotisation de pension vieillesse CNPS et l'impôt sur le revenu des personnes physiques et ses additionnels. Un bulletin de paie est remis au Salarié à chaque paiement.`;

const ORDERED = `## Procedure

1. Confirm the booking reference against the transit order.
2. Inspect the container and record its condition.`;

const roundTrip = (md: string) => docToMd(mdToDoc(md));

describe("the round trip", () => {
  it("returns a clause exactly as it went in", () => {
    for (const clause of [PARTIES_EN, DUTIES_EN, PARTIES_FR, PAY_FR, ORDERED]) {
      expect(roundTrip(clause)).toBe(clause);
    }
  });

  it("returns a whole contract exactly as it went in", () => {
    const whole = [PARTIES_EN, DUTIES_EN, PARTIES_FR, PAY_FR].join("\n\n");
    expect(roundTrip(whole)).toBe(whole);
  });

  it("is stable on a second pass", () => {
    // A format that changes on every save turns an untouched contract into a
    // diff, and "who last edited this" stops meaning anything.
    const once = roundTrip(DUTIES_EN);
    expect(roundTrip(once)).toBe(once);
  });

  it("keeps every article heading, which is what the PDF splits on", () => {
    const doc = mdToDoc([PARTIES_EN, DUTIES_EN, PARTIES_FR, PAY_FR].join("\n\n"));
    const headings = (doc.content || []).filter((n) => n.type === "heading");
    expect(headings).toHaveLength(4);
    expect(headings.map((h) => h.content?.[0]?.text)).toEqual([
      "Parties",
      "Engagement and Duties",
      "Parties",
      "Rémunération",
    ]);
    // And they come back as `##`, not as `#` or `###` — contractArticles
    // matches the exact shape the library writes.
    expect(roundTrip(PARTIES_EN).startsWith("## Parties\n")).toBe(true);
  });

  it("keeps French typography untouched", () => {
    // A non-breaking space that became a plain one would silently change
    // "500 000 XAF" into a number a French reader scans as wrong.
    expect(roundTrip(PAY_FR)).toContain("500 000 XAF");
    expect(roundTrip(PAY_FR)).toContain("L'Employeur");
  });
});

describe("the grammar", () => {
  it("carries bold and italic both ways", () => {
    const md = "The Employee is **not** entitled to *any* further payment.";
    const doc = mdToDoc(md);
    const marks = (doc.content?.[0]?.content || []).flatMap((n) => (n.marks || []).map((m) => m.type));
    expect(marks).toEqual(["bold", "italic"]);
    expect(docToMd(doc)).toBe(md);
  });

  it("writes bold outside italic so the scanner can read it back", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "bold" }, { type: "italic" }] }] }],
    };
    // `**` outside `*`. The other order opens with a single asterisk, which
    // the inline scanner reads as an empty italic followed by stray asterisks.
    expect(docToMd(doc)).toBe("***x***");
    expect(docToMd(mdToDoc(docToMd(doc)))).toBe("***x***");
  });

  it("keeps a hard break inside a paragraph rather than splitting the clause", () => {
    // A shift+enter is one `<br>` in the printed contract. Promoting it to a
    // paragraph break would add a blank line to a signed document.
    const md = "First line\nSecond line";
    expect(roundTrip(md)).toBe(md);
    const doc = mdToDoc(md);
    expect((doc.content?.[0]?.content || []).some((n) => n.type === "hardBreak")).toBe(true);
  });

  it("treats a lone heading-looking line inside a paragraph as text", () => {
    // Somebody typing "# 1 of the goods" mid-clause is writing a sentence, not
    // opening an article.
    const md = "The Employer shall supply:\n# 1 of the stated items";
    expect(roundTrip(md)).toBe(md);
  });
});

describe("the edges that break a mount", () => {
  it("gives an empty body one empty paragraph, never an empty document", () => {
    // ProseMirror refuses to mount a doc with no content, and the editor then
    // renders nothing at all with no error anybody can see.
    for (const empty of ["", "   ", null, undefined]) {
      const doc = mdToDoc(empty as string);
      expect(doc.content).toEqual([{ type: "paragraph" }]);
      expect(isEmptyDoc(doc)).toBe(true);
    }
  });

  it("drops an empty paragraph rather than writing a block of nothing", () => {
    const doc = { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph", content: [{ type: "text", text: "A." }] }] };
    expect(docToMd(doc)).toBe("A.");
  });

  it("passes an unknown node's children through instead of dropping them", () => {
    // The failure mode of a node this module does not know must be plain text
    // in the contract, which somebody can fix, not a clause that vanished.
    const doc = {
      type: "doc",
      content: [{ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted term." }] }] }],
    };
    expect(docToMd(doc)).toBe("Quoted term.");
  });

  it("normalises CRLF, so a paste from Word does not double every break", () => {
    expect(roundTrip("One.\r\n\r\nTwo.")).toBe("One.\n\nTwo.");
  });
});
