/**
 * Opening a link inside the app, and refreshing the screen that is open
 * (tenant review of 29 Sep 2026, item 1.6): the pure halves.
 */
import { describe, it, expect } from "vitest";
import { appPath, refreshFor, samePlace } from "./open-in-app";

const ORIGIN = "https://smartls.praxis-ls.com";

describe("appPath", () => {
  it("keeps a path on this origin and refuses anywhere else", () => {
    expect(appPath("/master/clients?focus=c1", ORIGIN)).toBe("/master/clients?focus=c1");
    expect(appPath(`${ORIGIN}/comms/clients`, ORIGIN)).toBe("/comms/clients");
    expect(appPath("https://evil.example/x", ORIGIN)).toBeNull();
    expect(appPath("//evil.example/x", ORIGIN)).toBeNull();
    expect(appPath(null, ORIGIN)).toBeNull();
  });
});

describe("samePlace — a bell click on the page already open", () => {
  it("matches the same path and query in any order", () => {
    const at = { pathname: "/master/clients", search: "?tab=Documents&focus=c1" };
    expect(samePlace("/master/clients?focus=c1&tab=Documents", at)).toBe(true);
    expect(samePlace("/master/clients?focus=c2&tab=Documents", at)).toBe(false);
    expect(samePlace("/comms/clients", at)).toBe(false);
  });
});

describe("refreshFor — a live arrival refreshes only the screen it is about", () => {
  const upload = {
    category: "clients",
    event_type_key: "client_request.submitted",
    link_url: "/master/clients?focus=c1&tab=Documents",
  };

  it("the open Client 360 of that client re-reads its portal lists", () => {
    const hit = refreshFor(upload, { pathname: "/master/clients", search: "?focus=c1&tab=Portal" });
    expect(hit?.detail).toEqual({ scope: "client", clientId: "c1" });
    expect(hit?.needles).toContain("/portal/client-requests");
  });

  it("another client's 360, or an unrelated screen, is left alone — no refetch storm", () => {
    expect(refreshFor(upload, { pathname: "/master/clients", search: "?focus=c2" })).toBeNull();
    expect(refreshFor(upload, { pathname: "/finance/invoices", search: "" })).toBeNull();
    expect(refreshFor({ category: "finance", event_type_key: "invoice.posted" }, { pathname: "/master/clients", search: "?focus=c1" })).toBeNull();
  });

  it("the Client inbox re-reads its conversations; Quote requests its register", () => {
    expect(refreshFor({ category: "clients", event_type_key: "client_message.received" }, { pathname: "/comms/clients", search: "" })?.needles).toEqual(["/portal/chat"]);
    const quote = refreshFor({ category: "clients", event_type_key: "quote_request.created" }, { pathname: "/sales/quote-requests", search: "" });
    expect(quote?.detail).toEqual({ scope: "quotes" });
  });
});
