/**
 * The page and tab index ⌘K searches without the server (meeting 6, G5), and
 * the matcher it scores with. What is pinned: the fold and the typo budget are
 * what the palette promises, every tab can say which record it belongs to, and
 * nothing that needs a record id is offered as a page.
 */
import { describe, it, expect } from "vitest";
import { search } from "@praxis/shared";
import registry from "@/app/screen-registry.json";
import { withinOneEdit, conceptsTyped, conceptsIn, score, fold } from "./search-match";
import { pageEntries, tabEntries, TYPE_LABEL, withTab } from "./search-index";

describe("the matcher", () => {
  it("folds case and accents with the shared table", () => {
    expect(fold("Société GÉNÉRALE")).toBe("societe generale");
    expect(fold("Œuvre")).toBe(search.fold("Œuvre"));
  });

  it("allows exactly one edit — insertion, deletion, substitution or swap", () => {
    expect(withinOneEdit("quotaion", "quotation")).toBe(true); // deletion
    expect(withinOneEdit("quottation", "quotation")).toBe(true); // insertion
    expect(withinOneEdit("quotatiom", "quotation")).toBe(true); // substitution
    expect(withinOneEdit("qoutation", "quotation")).toBe(true); // swap
    expect(withinOneEdit("qoutatoin", "quotation")).toBe(false); // two
  });

  it("reads real words through the one synonym list", () => {
    expect([...conceptsTyped("devis")]).toContain("quotation");
    expect([...conceptsTyped("cotation")]).toContain("quotation");
    expect([...conceptsTyped("facture")]).toContain("invoice");
    expect([...conceptsTyped("dossier")]).toContain("file");
    expect([...conceptsTyped("customer")]).toContain("client");
    expect([...conceptsIn("Quotations")]).toContain("quotation");
  });

  it("needs every typed word to match", () => {
    const c = { texts: ["Supplier invoices", "Factures fournisseurs"], concepts: new Set<string>() };
    expect(score("supplier inv", c)).toBeGreaterThan(0);
    expect(score("supplier payroll", c)).toBe(0);
  });

  it("does not let a two-letter word drift into another", () => {
    const c = { texts: ["Tax"], concepts: new Set<string>() };
    expect(score("tx", c)).toBe(0);
  });
});

describe("the index", () => {
  it("offers no public surface and no route that needs a record id", () => {
    for (const p of pageEntries()) {
      expect(p.to.includes(":")).toBe(false);
      expect(p.to.startsWith("/public")).toBe(false);
    }
  });

  it("carries every hub and a French title for every page", () => {
    const hubs = (registry as unknown as { hubs: { route: string }[] }).hubs;
    for (const h of hubs) expect(pageEntries().some((p) => p.kind === "hub" && p.to === h.route)).toBe(true);
    for (const p of pageEntries()) expect(p.titleFr.length).toBeGreaterThan(0);
  });

  it("names the record every tab belongs to, at a route the registry has", () => {
    const routes = new Set((registry.screens as { route: string }[]).map((s) => s.route));
    for (const t of tabEntries()) {
      for (const r of t.recordTypes) {
        expect(TYPE_LABEL[r], `TYPE_LABEL is missing "${r}"`).toBeTruthy();
        expect(routes.has(TYPE_LABEL[r].route)).toBe(true);
      }
    }
  });

  it("adds the tab to a record's address either way it is written", () => {
    expect(withTab("/master/clients?focus=c1", "Contacts")).toBe("/master/clients?focus=c1&tab=Contacts");
    expect(withTab("/operations/files/f1", "money")).toBe("/operations/files/f1?tab=money");
    expect(withTab("/x?focus=1", "Identity & registrations")).toBe("/x?focus=1&tab=Identity%20%26%20registrations");
  });
});
