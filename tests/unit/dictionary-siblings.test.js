"use strict";

/**
 * Meeting 6, PR 3 — section B (register 3.2, owner decision F2).
 *
 *   DoD 4  "Gate-Pass Fee" appears once in every picker; choosing "Billed to
 *          the client at cost" stores the débours sibling and "Our own cost"
 *          the expense sibling; a mismatch is flagged.
 *
 * The pickers all read the one search (financial_dictionary.service
 * searchItems) and draw the question and the guard from @praxis/shared
 * dictionarySibling, so those are what is pinned here; the picker's own
 * behaviour is pinned in client/src/components/dictionary-finder.siblings.test.tsx.
 */
const { dictionarySibling: sib } = require("@praxis/shared");
const service = require("../../src/modules/master/financial_dictionary/financial_dictionary.service");
const repo = require("../../src/modules/master/financial_dictionary/financial_dictionary.repo");

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => null),
  audit: jest.fn(async () => null),
}));

afterEach(() => jest.restoreAllMocks());

const G = "11111111-1111-4111-8111-111111111111";
const EXP = { dictionary_item_id: "e013", code: "#E013", label_en: "Gate-Pass Fee", label_fr: "Saisie du Ticket de Livraison", direction: "EXPENSE", is_disbursement: false, sibling_group: G };
const DEB = { dictionary_item_id: "d153", code: "#D153", label_en: "Gate-Pass Fee — Client Account", label_fr: "Saisie du Ticket de Livraison — Pour Compte Client", direction: "DISBURSEMENT", is_disbursement: true, sibling_group: G };
const OTHER = { dictionary_item_id: "r001", code: "#R001", label_en: "Commission on Disbursements", label_fr: "Commission sur Débours", direction: "REVENUE", sibling_group: null };

describe("@praxis/shared dictionarySibling", () => {
  it("names each mode, in both languages, as the owner worded it", () => {
    expect(sib.modeOf("DISBURSEMENT")).toBe("billed");
    expect(sib.modeOf("EXPENSE")).toBe("own");
    expect(sib.modeOf("ASSET")).toBe("deposit");
    expect(sib.answerFor("billed", "en")).toBe("Billed to the client at cost — débours, no VAT");
    expect(sib.answerFor("billed", "fr")).toBe("Refacturé au client au prix coûtant — débours, sans TVA");
    expect(sib.answerFor("own", "en")).toBe("Our own cost");
    expect(sib.answerFor("own", "fr")).toBe("Notre propre coût");
    expect(sib.answerFor("deposit", "en")).toBe("A deposit we lodge");
  });

  it("strips the sibling suffix, in either language", () => {
    expect(sib.baseLabel("Gate-Pass Fee — Client Account")).toBe("Gate-Pass Fee");
    expect(sib.baseLabel("Transport — Charge Propre")).toBe("Transport");
    expect(sib.baseLabel("Caution Bancaire — Dépôt")).toBe("Caution Bancaire");
    expect(sib.baseLabel("Gate-Pass Fee")).toBe("Gate-Pass Fee");
    expect(sib.hasSiblingSuffix("Lashing — Own Cost")).toBe(true);
    expect(sib.hasSiblingSuffix("Ocean Freight")).toBe(false);
  });

  it("presets from the context: a client-billed document → débours, our own purchase → own cost", () => {
    expect(sib.presetFor("billed", [EXP, DEB])).toBe(DEB);
    expect(sib.presetFor("own", [EXP, DEB])).toBe(EXP);
    expect(sib.presetFor(null, [EXP, DEB])).toBeNull();
  });

  it("flags a mismatch with one sentence and the sibling to switch to", () => {
    const own = sib.mismatch("billed", "EXPENSE", [EXP, DEB]);
    expect(own.to).toBe(DEB);
    expect(own.to_mode).toBe("billed");
    expect(own.reason.en).toMatch(/our own cost/i);
    const deb = sib.mismatch("own", "DISBURSEMENT", [EXP, DEB]);
    expect(deb.to).toBe(EXP);
    expect(sib.mismatch("billed", "DISBURSEMENT", [EXP, DEB])).toBeNull();
    expect(sib.mismatch("billed", "EXPENSE", [EXP])).toBeNull(); // nothing to switch to
    expect(sib.mismatch(null, "EXPENSE", [EXP, DEB])).toBeNull();
  });
});

describe("searchItems — a service appears once", () => {
  it("collapses the siblings to one hit at the best rank, carrying both modes", async () => {
    jest.spyOn(repo, "searchItems").mockResolvedValue([DEB, EXP, OTHER]);
    jest.spyOn(repo, "siblingsOfGroups").mockResolvedValue([EXP, DEB]);
    const out = await service.searchItems({}, { q: "gate" });
    const gate = out.filter((h) => h.sibling_group === G);
    expect(gate).toHaveLength(1);
    expect(gate[0].group_label_en).toBe("Gate-Pass Fee");
    expect(gate[0].group_label_fr).toBe("Saisie du Ticket de Livraison");
    // Offered in the question's order: billed first, then own cost.
    expect(gate[0].siblings.map((s) => [s.dictionary_item_id, s.mode])).toEqual([
      ["d153", "billed"],
      ["e013", "own"],
    ]);
    expect(out.map((h) => h.dictionary_item_id)).toEqual(["d153", "r001"]);
    expect(out[1].siblings).toEqual([]);
  });

  it("group:false (the service-type mapping) lists each mode as its own row", async () => {
    jest.spyOn(repo, "searchItems").mockResolvedValue([DEB, EXP]);
    jest.spyOn(repo, "siblingsOfGroups").mockResolvedValue([EXP, DEB]);
    const out = await service.searchItems({}, { q: "gate", group: false });
    expect(out.map((h) => h.dictionary_item_id)).toEqual(["d153", "e013"]);
  });

  it("a direction filter (a cash request only advances débours) does not collapse", async () => {
    jest.spyOn(repo, "searchItems").mockResolvedValue([DEB]);
    jest.spyOn(repo, "siblingsOfGroups").mockResolvedValue([EXP, DEB]);
    const out = await service.searchItems({}, { q: "gate", direction: "DISBURSEMENT" });
    expect(out.map((h) => h.dictionary_item_id)).toEqual(["d153"]);
  });
});

describe("linkSibling — one row per mode", () => {
  const client = () => {
    const sent = [];
    return {
      sent,
      async query(sql, params) {
        sent.push({ sql, params });
        if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
        if (/SELECT code FROM dictionary_item WHERE sibling_group = \$1 AND direction/.test(sql)) return { rows: [{ code: "#D153" }] };
        return { rows: [] };
      },
    };
  };

  it("refuses a second débours line in a service that already has one", async () => {
    const extra = { ...DEB, dictionary_item_id: "d999", code: "#D999", sibling_group: null };
    jest.spyOn(repo, "getItemRow").mockImplementation(async (_c, id) => (id === "d999" ? extra : EXP));
    const c = client();
    await expect(service.linkSibling(c, { id: "d999", linkTo: "e013", actor: { user_id: "u1" } })).rejects.toMatchObject({
      code: "SIBLING_MODE_TAKEN",
      status: 409,
    });
    expect(c.sent.some((q) => /ROLLBACK/.test(q.sql))).toBe(true);
  });
});

describe("Suggest charges — one line per service, preset from the file", () => {
  const suggest = require("../../src/modules/costing/costing/costing.suggest");
  const costingRepo = require("../../src/modules/costing/costing/costing.repo");

  const setup = (clientId) => {
    jest.spyOn(costingRepo, "dossierForCosting").mockResolvedValue({
      dossier_id: "f1", ref: "F-1", client_id: clientId, service_type_id: "st1", rate_provider_id: null,
    });
    jest.spyOn(costingRepo, "tieredItems").mockResolvedValue([
      { ...EXP, tier: "BASIC", sort_order: 1, unit_of_measure: "BL" },
      { ...DEB, tier: "BASIC", sort_order: 2, unit_of_measure: "BL" },
    ]);
    jest.spyOn(costingRepo, "containerTypesOnFile").mockResolvedValue([]);
    jest.spyOn(costingRepo, "ratesForItems").mockResolvedValue(new Map());
    jest.spyOn(costingRepo, "defaultSalesTaxCode").mockResolvedValue(null);
  };

  it("a client's file is billed: Gate-Pass Fee is suggested once, as the débours row", async () => {
    setup("c1");
    const out = await suggest.build({}, { dossierId: "f1" });
    const lines = out.bands.flatMap((b) => b.lines);
    expect(lines).toHaveLength(1);
    expect(lines[0].dictionary_item_id).toBe("d153");
    expect(lines[0].is_disbursement).toBe(true);
    expect(lines[0].siblings.map((s) => s.mode)).toEqual(["billed", "own"]);
    expect(out.file.fulfilment).toBe("billed");
  });

  it("a file with no client is our own cost", async () => {
    setup(null);
    const out = await suggest.build({}, { dossierId: "f1" });
    const lines = out.bands.flatMap((b) => b.lines);
    expect(lines.map((l) => l.dictionary_item_id)).toEqual(["e013"]);
  });
});
