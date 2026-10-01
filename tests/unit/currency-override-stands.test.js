"use strict";

/**
 * Meeting 6, PR 3 — section A (register 3.1, owner decision F1).
 *
 *   DoD 1  EUR → XAF, XAF → EUR, EUR → XOF and XOF → EUR resolve to the parity
 *          everywhere, including the costing pre-fill; a hand-entered EUR rate
 *          is refused.
 *   DoD 2  A manual USD override set yesterday still wins after tonight's feed,
 *          until released.
 *
 * Pure resolver first (currency.rules.pickRate), then the service entry points
 * every reader goes through (rateFor, setRate, parityToXaf, releaseOverride,
 * costing.fxRate). The SQL twin of pickRate — repo.latestRatesFromBase — is
 * exercised against a real database in tests/integration/currency-override.test.js.
 */
const { pickRate, isStanding, isReleased } = require("../../src/modules/master/currency/currency.rules");
const service = require("../../src/modules/master/currency/currency.service");
const repo = require("../../src/modules/master/currency/currency.repo");
const { currencies } = require("@praxis/shared");

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => null),
  audit: jest.fn(async () => null),
}));

afterEach(() => jest.restoreAllMocks());

const PARITY = 655.957;
const row = (o) => ({ base_code: "XAF", quote_code: "USD", source: "exchangerate-api", is_override: false, released_on: null, ...o });

describe("the peg lives in @praxis/shared", () => {
  it("XAF and XOF are pegged to EUR at 655.957 by BEAC and BCEAO", () => {
    expect(currencies.pegOf("XAF")).toMatchObject({ anchor: "EUR", per_anchor: PARITY, authority: "BEAC" });
    expect(currencies.pegOf("xof")).toMatchObject({ anchor: "EUR", per_anchor: PARITY, authority: "BCEAO" });
    expect(currencies.pegOf("USD")).toBeNull();
  });

  it("answers every direction from the peg itself, never an inverse of a rounded figure", () => {
    expect(currencies.fixedParity("EUR", "XAF").rate).toBe(PARITY);
    expect(currencies.fixedParity("XAF", "EUR").rate).toBe(1 / PARITY);
    expect(currencies.fixedParity("EUR", "XOF").rate).toBe(PARITY);
    expect(currencies.fixedParity("XOF", "EUR").rate).toBe(1 / PARITY);
    expect(currencies.fixedParity("XAF", "XOF").rate).toBe(1);
    expect(currencies.fixedParity("USD", "XAF")).toBeNull();
    expect(currencies.fixedParity("EUR", "EUR")).toBeNull();
    expect(currencies.isFixedPair("XAF", "GBP")).toBe(false);
  });
});

describe("pickRate — fixed parity", () => {
  it("ignores every stored row for a pegged pair, in both directions", () => {
    const stored = [row({ quote_code: "EUR", rate: 0.001524, as_of_date: "2026-09-29" })];
    const a = pickRate(stored, "XAF", "EUR", "2026-09-30");
    expect(a).toMatchObject({ rate: 1 / PARITY, source: "fixed-parity", is_fixed: true, authority: "BEAC" });
    const b = pickRate([], "EUR", "XAF", "2026-09-30");
    expect(b).toMatchObject({ rate: PARITY, is_fixed: true });
    expect(pickRate([], "EUR", "XOF", "2026-09-30").rate).toBe(PARITY);
    expect(pickRate([], "XOF", "EUR", "2026-09-30").rate).toBe(1 / PARITY);
  });
});

describe("pickRate — a manual override stands until released", () => {
  const yesterday = "2026-09-30";
  const today = "2026-10-01";
  const override = row({ rate: 0.0017, as_of_date: yesterday, source: "manual", is_override: true, fetched_at: "2026-09-30T15:00:00Z" });
  const feedTonight = row({ rate: 0.00163, as_of_date: today, fetched_at: "2026-10-01T00:00:05Z" });

  it("DoD 2: yesterday's USD override beats tonight's feed row", () => {
    const got = pickRate([feedTonight, override], "XAF", "USD", today);
    expect(got.rate).toBe(0.0017);
    expect(got.standing).toBe(true);
  });

  it("…and keeps beating feed rows for as long as nobody releases it", () => {
    const later = row({ rate: 0.00161, as_of_date: "2026-10-09" });
    expect(pickRate([later, feedTonight, override], "XAF", "USD", "2026-10-09").rate).toBe(0.0017);
  });

  it("a newer override replaces an older one", () => {
    const newer = row({ rate: 0.0018, as_of_date: today, source: "manual", is_override: true });
    expect(pickRate([override, feedTonight, newer], "XAF", "USD", today).rate).toBe(0.0018);
  });

  it("once released, the feed applies from the release day — and the past still resolves to the override", () => {
    const released = { ...override, released_on: today };
    expect(pickRate([feedTonight, released], "XAF", "USD", today).rate).toBe(0.00163);
    // A costing priced yesterday re-resolves to what was in force then.
    expect(pickRate([feedTonight, released], "XAF", "USD", yesterday).rate).toBe(0.0017);
  });

  it("a pair only ever priced by hand still resolves after a release", () => {
    const released = { ...override, released_on: today };
    expect(pickRate([released], "XAF", "USD", today).rate).toBe(0.0017);
  });

  it("a rebase anchor is not a human decision: tomorrow's feed beats it", () => {
    const rebase = row({ rate: 0.0015, as_of_date: yesterday, source: "rebase", is_override: true });
    expect(pickRate([feedTonight, rebase], "XAF", "USD", today).rate).toBe(0.00163);
    // …but it still wins on its own date, as before.
    const sameDayFeed = row({ rate: 0.0016, as_of_date: yesterday });
    expect(pickRate([sameDayFeed, rebase], "XAF", "USD", yesterday).rate).toBe(0.0015);
  });

  it("classifies by source and release date", () => {
    expect(isStanding(override, today)).toBe(true);
    expect(isStanding({ ...override, released_on: "2026-10-02" }, today)).toBe(true);
    expect(isReleased({ ...override, released_on: today }, today)).toBe(true);
    expect(isStanding(feedTonight, today)).toBe(false);
  });
});

describe("rateFor / convertAmount / setRate — the service every reader uses", () => {
  it("rateFor answers a pegged pair without reading a row", async () => {
    const spy = jest.spyOn(repo, "ratesForPair");
    const r = await service.rateFor({}, { base: "EUR", quote: "XAF", date: "2026-10-01" });
    expect(r).toMatchObject({ base: "EUR", quote: "XAF", rate: PARITY, is_fixed: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it("convertAmount converts at the parity", async () => {
    const out = await service.convertAmount({}, { amount: 100, base: "EUR", quote: "XAF", date: "2026-10-01" });
    expect(out.rate).toBe(PARITY);
    expect(out.converted).toBe(65595.7);
  });

  it("a hand-entered EUR rate is refused, in either direction", async () => {
    const write = jest.spyOn(repo, "upsertRate");
    await expect(service.setRate({}, { base: "XAF", quote: "EUR", rate: 1 / 656.168 })).rejects.toMatchObject({ code: "FIXED_PARITY", status: 422 });
    await expect(service.setRate({}, { base: "EUR", quote: "XAF", rate: 656.168 })).rejects.toMatchObject({ code: "FIXED_PARITY" });
    await expect(service.setRate({}, { base: "XAF", quote: "EUR", rate: 1 / 656.168 })).rejects.toThrow(/1 EUR = 655\.957 XAF/);
    expect(write).not.toHaveBeenCalled();
  });

  it("parityToXaf: the parity for EUR/XOF, a refusal for another figure, null for a floating currency", () => {
    expect(service.parityToXaf("EUR")).toBe(PARITY);
    expect(service.parityToXaf("EUR", PARITY)).toBe(PARITY);
    expect(service.parityToXaf("XOF", 1)).toBe(1);
    expect(() => service.parityToXaf("EUR", 656.168)).toThrow(expect.objectContaining({ code: "FIXED_PARITY" }));
    expect(service.parityToXaf("USD", 615)).toBeNull();
    expect(service.parityToXaf("XAF")).toBeNull();
  });

  it("releaseOverride releases and answers the rate now in force", async () => {
    jest.spyOn(repo, "releaseOverrides").mockResolvedValue([{ fx_rate_id: "r1", rate: "0.0017", as_of_date: "2026-09-30" }]);
    jest.spyOn(repo, "ratesForPair").mockResolvedValue([row({ rate: "0.00163", as_of_date: "2026-10-01" })]);
    const out = await service.releaseOverride({}, { base: "xaf", quote: "usd", actor: { user_id: "u1" } });
    expect(repo.releaseOverrides).toHaveBeenCalledWith({}, { base: "XAF", quote: "USD", userId: "u1" });
    expect(out).toMatchObject({ base: "XAF", quote: "USD", released: 1 });
    expect(Number(out.rate.rate)).toBe(0.00163);
  });

  it("releaseOverride with nothing standing is a 409", async () => {
    jest.spyOn(repo, "releaseOverrides").mockResolvedValue([]);
    await expect(service.releaseOverride({}, { base: "XAF", quote: "USD" })).rejects.toMatchObject({ code: "NO_STANDING_OVERRIDE", status: 409 });
  });
});

describe("the costing pre-fill (GET /costings/fx-rate)", () => {
  const costing = require("../../src/modules/costing/costing/costing.service");

  it("returns the parity for EUR, marked fixed, whatever the feed stored", async () => {
    jest.spyOn(repo, "ratesForPair").mockResolvedValue([row({ base_code: "EUR", quote_code: "XAF", rate: "656.168", as_of_date: "2026-09-30" })]);
    const out = await costing.fxRate({}, { currency: "eur", on_date: "2026-10-01" });
    expect(out).toMatchObject({ currency: "EUR", rate_to_xaf: PARITY, found: true, fixed: true, authority: "BEAC", source: "fixed-parity" });
  });

  it("a floating currency is not marked fixed", async () => {
    jest.spyOn(repo, "ratesForPair").mockResolvedValue([row({ base_code: "USD", quote_code: "XAF", rate: "612.4", as_of_date: "2026-09-30" })]);
    const out = await costing.fxRate({}, { currency: "USD", on_date: "2026-10-01" });
    expect(out).toMatchObject({ rate_to_xaf: 612.4, fixed: false });
  });
});
