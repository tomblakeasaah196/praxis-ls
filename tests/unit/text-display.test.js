"use strict";

/**
 * packages/shared/text/display.js: how a legal name and a phone read on a page
 * (visitor pass on the SmartLS staging site, 25 Nov 2026).
 */
const { legalNameWithForm, nameCarriesForm, phoneDisplay, phoneHref } = require("@praxis/shared/text/display");

describe("legalNameWithForm", () => {
  test("a name that already says its form in English does not get it twice", () => {
    expect(legalNameWithForm("SMART LOGISTICS AND SERVICES LTD", "SARL")).toBe("SMART LOGISTICS AND SERVICES LTD");
    expect(legalNameWithForm("Acme Limited", "SARL")).toBe("Acme Limited");
  });

  test("a name that carries the form as written is left alone", () => {
    expect(legalNameWithForm("Smart Logistics and Services UG (haftungsbeschränkt)", "UG (haftungsbeschränkt)"))
      .toBe("Smart Logistics and Services UG (haftungsbeschränkt)");
    expect(legalNameWithForm("Acme S.A.R.L.", "SARL")).toBe("Acme S.A.R.L.");
    expect(legalNameWithForm("Acme GmbH", "GmbH")).toBe("Acme GmbH");
  });

  test("a name without its form gets it appended", () => {
    expect(legalNameWithForm("Acme", "SARL")).toBe("Acme SARL");
    expect(legalNameWithForm("Acme", "GmbH")).toBe("Acme GmbH");
  });

  test("no form, or no name, prints what there is", () => {
    expect(legalNameWithForm("Acme", null)).toBe("Acme");
    expect(legalNameWithForm(null, "SARL")).toBe("");
  });

  test("a word that merely contains the form's letters is not the form", () => {
    // "SAS" inside "SASKIA" is not a SAS.
    expect(nameCarriesForm("Saskia Freight", "SAS")).toBe(false);
  });
});

describe("phoneDisplay", () => {
  test("Cameroon reads in the country's own grouping", () => {
    expect(phoneDisplay("+237233420281")).toBe("+237 233 42 02 81");
  });

  test("the corridor and Europe", () => {
    expect(phoneDisplay("+23566123456")).toBe("+235 66 12 34 56");
    expect(phoneDisplay("+33612345678")).toBe("+33 6 12 34 56 78");
    expect(phoneDisplay("+4962112345678")).toBe("+49 621 12345678");
    expect(phoneDisplay("+491701234567")).toBe("+49 170 1234567");
  });

  test("a number typed with its own spacing, or not E.164, is shown as typed", () => {
    expect(phoneDisplay("+237 233 420 281")).toBe("+237 233 420 281");
    expect(phoneDisplay("0621 123")).toBe("0621 123");
    expect(phoneDisplay(null)).toBe("");
  });

  test("the tel: link keeps digits and the plus only", () => {
    expect(phoneHref("+237 233 42 02 81")).toBe("tel:+237233420281");
  });
});
