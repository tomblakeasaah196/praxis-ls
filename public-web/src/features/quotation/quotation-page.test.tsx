import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QuotationPage } from "@/features/quotation/quotation-page";
import { en } from "@/features/quotation/quotation-copy";
import "@/lib/i18n";

/**
 * The public quotation link `/q/<token>` (Sales lean revamp PR 6, guide §3.4
 * "The link"), against a stubbed `quotation_public` API: it shows the server's
 * one render, answers with a signed accept, a named confirm or a decline, then
 * reads as answered; and any 404 is the one calm page.
 */

const HTML = "<!doctype html><html><body><h1>QT-2026-0004</h1><p>Sea freight, Shanghai to Douala</p></body></html>";

const READ = (over: Record<string, unknown> = {}, quotation: Record<string, unknown> = {}) => ({
  quotation: {
    doc_number: "QT-2026-0004",
    title: "Tiles, Shanghai to Douala",
    status: "SENT",
    output: "FULL",
    version: 1,
    currency: "XAF",
    valid_until: "2099-12-31",
    sent_at: "2026-11-10T09:00:00Z",
    answered_at: null,
    decline_reason: null,
    totals: { ht: 1000000, vat: 192500, ttc: 1192500 },
    party: { name: "Acme Trading" },
    ...quotation,
  },
  language: "EN",
  languages: ["EN", "FR"],
  html: HTML,
  signature: null,
  open: true,
  signing: {
    available: true,
    cards: [
      { preset_code: "STAMP", label: "Stamp", blurb: null },
      { preset_code: "DRAWN", label: "Drawn", blurb: null },
    ],
  },
  decline_reasons: [
    { reason_code: "PRICE", label: "The price" },
    { reason_code: "TIMING", label: "The timing" },
  ],
  ...over,
});

const ANSWERED = READ(
  {
    open: false,
    signing: { available: false, cards: [] },
    decline_reasons: [],
    signature: { signer_name: "Marie Nguema", signer_role: "Finance", signed_at: "2026-11-18T09:00:00Z", mark: "STAMP", assurance: "OTP", verify_code: "ABCD1234" },
  },
  { status: "ACCEPTED", answered_at: "2026-11-18T09:00:00Z" },
);

type Reply = [number, unknown];
type Handler = (body: unknown) => Reply;

/** Route by method and path; a GET handler may be a list, served in order. */
function stub(routes: Record<string, Handler | Reply[]>) {
  const calls: { method: string; path: string; query: string; body: unknown }[] = [];
  const served = new Map<string, number>();
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, query: url.search, body });
    const key = `${method} ${url.pathname}`;
    const route = routes[key];
    let reply: Reply = [404, { error: { code: "NOT_FOUND" } }];
    if (Array.isArray(route)) {
      const n = served.get(key) || 0;
      served.set(key, n + 1);
      reply = route[Math.min(n, route.length - 1)];
    } else if (route) reply = route(body);
    const [status, data] = reply;
    return new Response(JSON.stringify(status < 300 ? { data } : data), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch);
  return calls;
}

const BASE = "/api/tenant/public/quotations/tok123";

/** A LABEL renders in Title Case (owner decision D5, lib/label-case.ts), and a
 *  required field carries its asterisk: match the words, not their casing. */
const L = (words: string) => new RegExp(`^${words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*?$`, "i");

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/public/q/:token" element={<QuotationPage />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("the public quotation page", () => {
  it("shows the server's one render in a frame that runs nothing, with the languages offered and Download PDF", async () => {
    const calls = stub({ [`GET ${BASE}`]: [[200, READ()]] });
    renderAt("/public/q/tok123?lang=EN");
    expect(await screen.findByRole("heading", { level: 1, name: "Tiles, Shanghai to Douala" })).toBeTruthy();
    const frame = screen.getByTitle(en.document) as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toBe(HTML);
    // Sandboxed: no scripts, ever.
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(calls[0].query).toBe("?lang=EN");
    const group = screen.getByRole("group", { name: L(en.langSwitch) });
    expect([...group.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["EN", "FR"]);
    const pdf = screen.getAllByRole("link").find((a) => a.getAttribute("href")?.includes("/pdf"));
    expect(pdf?.getAttribute("href")).toBe(`${BASE}/pdf?lang=EN`);
    expect(screen.getByRole("button", { name: L(en.accept) })).toBeTruthy();
    expect(screen.getByRole("button", { name: L(en.decline) })).toBeTruthy();
  });

  it("offers only the languages the quotation is in", async () => {
    stub({ [`GET ${BASE}`]: [[200, READ({ languages: ["FR"], language: "FR" })]] });
    renderAt("/public/q/tok123");
    await screen.findByTitle(en.document);
    expect(screen.queryByRole("group", { name: L(en.langSwitch) })).toBeNull();
    const pdf = screen.getAllByRole("link").find((a) => a.getAttribute("href")?.includes("/pdf"));
    expect(pdf?.getAttribute("href")).toBe(`${BASE}/pdf?lang=FR`);
  });

  it("accepts by signing: name and role, the emailed code (resent once), then the stamp; then reads as accepted", async () => {
    const calls = stub({
      [`GET ${BASE}`]: [[200, READ()], [200, ANSWERED]],
      [`POST ${BASE}/accept/start`]: () => [200, { signer: { full_name: "Marie Nguema", email_masked: "m***@acme.cm" }, cards: READ().signing.cards, otp: null }],
      [`POST ${BASE}/accept/resend`]: () => [200, { otp: null }],
      [`POST ${BASE}/accept/complete`]: () => [200, { accepted: true, signature: ANSWERED.signature }],
    });
    renderAt("/public/q/tok123");
    fireEvent.click(await screen.findByRole("button", { name: L(en.accept) }));
    const send = screen.getByRole("button", { name: L(en.sendCode) }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(L(en.name)), { target: { value: "Marie Nguema" } });
    fireEvent.change(screen.getByLabelText(L(en.role)), { target: { value: "Finance" } });
    fireEvent.click(send);
    await screen.findByText(en.codeSent.replace("{{email}}", "m***@acme.cm"));
    expect(calls.find((c) => c.path.endsWith("/accept/start"))?.body).toEqual({ full_name: "Marie Nguema", role: "Finance" });

    fireEvent.click(screen.getByRole("button", { name: L(en.resend) }));
    await screen.findByText(en.resent);
    expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/accept/resend"))).toBe(true);

    fireEvent.change(screen.getByLabelText(L(en.digit.replace("{{n}}", "1"))), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: L(en.next) }));
    // Two cards offered: the signer picks; the stamp is the default.
    expect(screen.getByRole("button", { name: L(en.card.STAMP) }).getAttribute("aria-pressed")).toBe("true");
    screen.getByText(en.agree);
    fireEvent.click(screen.getByRole("button", { name: L(en.sign) }));

    await screen.findByText(en.accepted);
    expect(calls.find((c) => c.path.endsWith("/accept/complete"))?.body).toEqual({
      code: "123456",
      preset_code: "STAMP",
      full_name: "Marie Nguema",
      role: "Finance",
    });
    await screen.findByText(L(en.signedBy.replace("{{name}}", "Marie Nguema")));
    expect(screen.getByText("ABCD-1234")).toBeTruthy();
    expect(screen.getAllByText(L(en.status.ACCEPTED)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: L(en.accept) })).toBeNull();
    expect(screen.queryByRole("button", { name: L(en.decline) })).toBeNull();
  });

  it("sends a wrong code back to the code step with the reason", async () => {
    stub({
      [`GET ${BASE}`]: [[200, READ()]],
      [`POST ${BASE}/accept/start`]: () => [200, { signer: { full_name: "M", email_masked: "m***@acme.cm" }, cards: [], otp: null }],
      [`POST ${BASE}/accept/complete`]: () => [422, { error: { code: "OTP_INVALID", message: "Invalid code" } }],
    });
    renderAt("/public/q/tok123");
    fireEvent.click(await screen.findByRole("button", { name: L(en.accept) }));
    fireEvent.change(screen.getByLabelText(L(en.name)), { target: { value: "Marie Nguema" } });
    fireEvent.click(screen.getByRole("button", { name: L(en.sendCode) }));
    fireEvent.change(await screen.findByLabelText(L(en.digit.replace("{{n}}", "1"))), { target: { value: "999999" } });
    fireEvent.click(screen.getByRole("button", { name: L(en.next) }));
    fireEvent.click(screen.getByRole("button", { name: L(en.sign) }));
    expect((await screen.findByRole("alert")).textContent).toBe(en.otp.OTP_INVALID);
    expect(screen.getByRole("button", { name: L(en.next) })).toBeTruthy();
  });

  it("accepts by name where the tenant offers no e-signature: the confirm, never called a signature", async () => {
    const calls = stub({
      [`GET ${BASE}`]: [[200, READ({ signing: { available: false, cards: [] } })], [200, READ({ open: false, signing: { available: false, cards: [] } }, { status: "ACCEPTED" })]],
      [`POST ${BASE}/accept`]: () => [200, { accepted: true, signature: null }],
    });
    renderAt("/public/q/tok123");
    fireEvent.click(await screen.findByRole("button", { name: L(en.accept) }));
    screen.getByText(en.confirmBody);
    expect(screen.queryByRole("button", { name: L(en.sendCode) })).toBeNull();
    fireEvent.change(screen.getByLabelText(L(en.name)), { target: { value: "Marie Nguema" } });
    fireEvent.click(screen.getByRole("button", { name: L(en.confirm) }));
    await screen.findByText(en.accepted);
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ path: `${BASE}/accept`, body: { full_name: "Marie Nguema", role: null } });
    expect(calls.some((c) => c.path.endsWith("/accept/start"))).toBe(false);
    await waitFor(() => expect(screen.queryByRole("button", { name: L(en.accept) })).toBeNull());
  });

  it("declines with a reason from the list and a line, then reads as declined", async () => {
    const calls = stub({
      [`GET ${BASE}`]: [[200, READ()], [200, READ({ open: false, decline_reasons: [] }, { status: "REJECTED", decline_reason: "The price: Too high for Q4" })]],
      [`POST ${BASE}/decline`]: () => [200, { declined: true }],
    });
    renderAt("/public/q/tok123");
    fireEvent.click(await screen.findByRole("button", { name: L(en.decline) }));
    const send = screen.getByRole("button", { name: L(en.declineSend) }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("The price"));
    fireEvent.change(screen.getByLabelText(L(en.declineNote)), { target: { value: "Too high for Q4" } });
    fireEvent.click(send);
    await screen.findByText(en.declined);
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ path: `${BASE}/decline`, body: { reason_code: "PRICE", note: "Too high for Q4" } });
    await screen.findByText("The price: Too high for Q4");
    expect(screen.getAllByText(L(en.status.REJECTED)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: L(en.decline) })).toBeNull();
  });

  it("reads an already answered or expired quotation as such, with no answer buttons", async () => {
    stub({ [`GET ${BASE}`]: [[200, READ({ open: false, signing: { available: false, cards: [] }, decline_reasons: [] }, { status: "EXPIRED" })]] });
    renderAt("/public/q/tok123");
    await screen.findByTitle(en.document);
    expect(screen.getAllByText(L(en.status.EXPIRED)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: L(en.accept) })).toBeNull();
    expect(screen.queryByRole("button", { name: L(en.decline) })).toBeNull();
  });

  it("shows one calm page for an expired, revoked or unknown link, and offers no sign-in", async () => {
    stub({});
    renderAt("/public/q/expired");
    expect(await screen.findByText(en.unavailable)).toBeTruthy();
    screen.getByText(en.unavailableHint);
    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(screen.queryByRole("button", { name: L(en.accept) })).toBeNull();
  });
});
