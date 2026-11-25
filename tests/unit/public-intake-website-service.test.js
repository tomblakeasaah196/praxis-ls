"use strict";

/**
 * A website quote through a WEBSITE SERVICE (SmartLS website v2, PR 3): the
 * server runs the quote engine itself on the visitor's answers, against the
 * tenant's own members and routing rules, and stores why the request landed
 * where it did. Nothing the browser says about the outcome is read.
 */

jest.mock("../../src/modules/sales/quote_request/quote_request.service");
jest.mock("../../src/modules/operations/geo_place/geo_place.service");
jest.mock("../../src/modules/vault/document_vault/document_vault.service");
jest.mock("../../src/shared/db/tx", () => ({ atomically: (_c, fn) => fn() }));
jest.mock("../../src/config/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const quote = require("../../src/modules/sales/quote_request/quote_request.service");
const service = require("../../src/modules/sales/public_intake/public_intake.service");
const { schemas } = require("../../src/modules/sales/public_intake/public_intake.validator");

const SEA = "11111111-1111-4111-8111-111111111111"; // the website service (Sea Freight Import's profile)
const SEA_EXPORT = "22222222-2222-4222-8222-222222222222";
const SEA_E2E = "33333333-3333-4333-8333-333333333333";
const ALL = ["EXW", "FCA", "FAS", "FOB", "CPT", "CIP", "CFR", "CIF", "DAP", "DPU", "DDP"];

/** A tenant connection answering the three reads the engine path makes. */
function fakeClient({ published = true } = {}) {
  return {
    query: jest.fn(async (sql) => {
      if (/FROM service_type_web_profile p\s+JOIN service_type st/.test(sql) && /is_published = true AND st.is_active/.test(sql)) {
        return {
          rows: published
            ? [{ service_type_id: SEA, web_name_en: "Sea Freight", name_en: "Sea Freight Import", service_key: "SEA_FREIGHT_IMPORT", transport_mode: "SEA" }]
            : [],
        };
      }
      if (/UNION ALL/.test(sql)) {
        return {
          rows: [
            { website_service_id: SEA, service_type_id: SEA, key: "SEA_FREIGHT_IMPORT", name_en: "Sea Freight Import", territory: "INTERNATIONAL_IMPORT", incoterms: ALL },
            { website_service_id: SEA, service_type_id: SEA_EXPORT, key: "SEA_FREIGHT_EXPORT", name_en: "Sea Freight Export", territory: "INTERNATIONAL_EXPORT", incoterms: ALL },
            { website_service_id: SEA, service_type_id: SEA_E2E, key: "END_TO_END_SEA_FREIGHT", name_en: "End-to-End Sea Freight", territory: "END_TO_END_INTERNATIONAL", incoterms: ALL },
          ],
        };
      }
      if (/FROM quote_route_rule/.test(sql)) {
        const { quoteEngine } = require("@praxis/shared");
        return { rows: quoteEngine.DEFAULT_RULES.map((r) => ({ ...r })) };
      }
      return { rows: [] };
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  quote.resolveEntityId.mockResolvedValue("entity-1");
  quote.resolveService.mockImplementation(async (_c, id) => ({ service_type_id: id, incoterms: ALL, territory: "X" }));
  quote.assertIncotermOffered.mockImplementation(() => {});
  quote.create.mockImplementation(async (_c, { data }) => ({ quote_request_id: "qr-1", public_ref: "QR-1", ...data }));
});

const submit = (body, client = fakeClient()) => service.submitQuote(client, { requester_email: "a@b.co", ...body });
const created = () => quote.create.mock.calls[0][1];

describe("the engine decides the type, the term and the scope", () => {
  test("Sea Freight, importing, DDP lands on End-to-End Sea Freight, with the reason recorded", async () => {
    await submit({ website_service_id: SEA, quote_answers: { direction: "IMPORT", knows: "YES", incoterm: "DDP" } });
    const { data, options } = created();
    expect(data).toMatchObject({
      service_type_id: SEA_E2E,
      incoterm: "DDP",
      website_service_id: SEA,
      trade_direction: "IMPORT",
      incoterm_source: "PICKED",
    });
    expect(data.service_scope).toMatchObject({ origin_pickup: true, duties_taxes: true, final_delivery: true });
    expect(data.quote_routing).toMatchObject({ engine: 1, outcome: "RESOLVED", span: "OMD", website_service_name: "Sea Freight" });
    expect(data.quote_routing.explanation.en).toMatch(/^This is DDP:/);
    expect(data.quote_answers).toBeUndefined();
    // A member need not be published itself; the website service is.
    expect(options).toMatchObject({ publishedOnly: false, requireDirection: false });
    expect(quote.resolveService).toHaveBeenCalledWith(expect.anything(), SEA_E2E, { publishedOnly: false });
  });

  test("Sea Freight, importing, CIF lands on Sea Freight Import", async () => {
    await submit({ website_service_id: SEA, quote_answers: { direction: "IMPORT", knows: "YES", incoterm: "CIF" } });
    expect(created().data).toMatchObject({ service_type_id: SEA, incoterm: "CIF", incoterm_source: "PICKED" });
  });

  test("plain answers derive the term: buying, supplier's premises to my premises is EXW, end to end", async () => {
    await submit({
      website_service_id: SEA,
      quote_answers: { direction: "IMPORT", knows: "NO", party: "BUYER", start: "SUPPLIER_PREMISES", end: "PREMISES" },
    });
    expect(created().data).toMatchObject({ service_type_id: SEA_E2E, incoterm: "EXW", incoterm_source: "DERIVED" });
  });

  test("whatever the browser claims about the outcome is ignored", async () => {
    await submit({
      website_service_id: SEA,
      service_type_id: SEA_EXPORT,
      incoterm: "FOB",
      quote_answers: { direction: "IMPORT", knows: "YES", incoterm: "DDP" },
    });
    expect(created().data).toMatchObject({ service_type_id: SEA_E2E, incoterm: "DDP" });
  });

  test("not sure goes to the desk: no type, the website service's name, the reason", async () => {
    await submit({ website_service_id: SEA, quote_answers: { direction: "IMPORT", knows: "YES", incoterm: "NOT_SURE" } });
    const { data } = created();
    expect(data.service_type_id).toBeUndefined();
    expect(data).toMatchObject({ incoterm: "TBD", incoterm_source: "NOT_SURE", service_category: "Sea Freight" });
    expect(data.quote_routing).toMatchObject({ outcome: "DESK", reason: "NOT_SURE" });
    expect(quote.resolveService).not.toHaveBeenCalled();
  });
});

describe("what is refused", () => {
  test("an answer that is not one of the choices is a 422 naming it", async () => {
    await expect(submit({ website_service_id: SEA, quote_answers: { direction: "IMPORT", knows: "YES", incoterm: "XYZ" } }))
      .rejects.toMatchObject({ status: 422, code: "QUOTE_ANSWERS_INVALID", details: { "quote_answers.incoterm": expect.any(Array) } });
    expect(quote.create).not.toHaveBeenCalled();
  });

  test("an unanswered question is a 422 naming it", async () => {
    await expect(submit({ website_service_id: SEA, quote_answers: { direction: "IMPORT" } }))
      .rejects.toMatchObject({ status: 422, code: "QUOTE_ANSWERS_INCOMPLETE", details: { "quote_answers.knows": ["required"] } });
  });

  test("a website service that is not published is a 422", async () => {
    await expect(submit({ website_service_id: SEA, quote_answers: {} }, fakeClient({ published: false })))
      .rejects.toMatchObject({ status: 422, code: "SERVICE_TYPE_INVALID" });
  });
});

describe("the public schema", () => {
  const parse = (body) => schemas.quote.safeParse(body);
  test("a website service needs no incoterm in the body; the older form still does", () => {
    expect(parse({ website_service_id: SEA, quote_answers: { direction: "IMPORT" } }).success).toBe(true);
    expect(parse({ origin_location: "Shanghai" }).success).toBe(false);
    expect(parse({ incoterm: "FOB" }).success).toBe(true);
  });
  test("an unknown answer key is refused", () => {
    expect(parse({ website_service_id: SEA, quote_answers: { mood: "happy" } }).success).toBe(false);
  });
});
