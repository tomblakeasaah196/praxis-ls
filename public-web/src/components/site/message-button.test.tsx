import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
/* For its side effect: `lib/i18n` initialises i18next on import. */
import "@/lib/i18n";
import { MessageButton } from "@/components/site/message-button";
import { setHumanToken, takeHumanToken } from "@/lib/human-check";
import { en } from "@/lib/i18n-dict";

/**
 * The floating message button (SmartLS website v2, PR 2).
 *
 * Pinned: the email is asked first and remembered for the browser session; the
 * panel is a real modal dialog, named, that Escape closes and that hands focus
 * back to the button; and a site with no Turnstile keys sends without a check.
 */

const tc = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const label = (s: string) => new RegExp(`^${s}$`, "i");
/** A field's label may carry a required marker after the words. */
const field = (s: string) => new RegExp(`^${s}\\s*\\*?$`, "i");

let posts: { url: string; body: unknown; headers: Headers }[] = [];

beforeEach(() => {
  posts = [];
  window.sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/public/intake/config")) {
        return new Response(JSON.stringify({ data: { turnstile_site_key: null } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      posts.push({ url: String(url), body: JSON.parse(String(init?.body || "{}")), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ data: { received: true, reference: "MSG-7Z3K9QW2", attachments: 0 } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const open = async () => {
  render(<MessageButton />);
  const button = screen.getByRole("button", { name: label(en.site.message.open) });
  await act(async () => {
    fireEvent.click(button);
    await new Promise((r) => setTimeout(r, 0));
  });
  return { button, dialog: await screen.findByRole("dialog") };
};

describe("the message button", () => {
  it("opens a named modal dialog that asks for the email first", async () => {
    const { button, dialog } = await open();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName(label(en.site.message.title));
    expect(screen.getByLabelText(field(en.site.message.email))).toBeInTheDocument();
    expect(screen.queryByLabelText(field(en.site.message.body))).toBeNull();
  });

  it("refuses an address that is not one, then remembers a good one for the session", async () => {
    await open();
    const email = screen.getByLabelText(field(en.site.message.email));
    fireEvent.change(email, { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: label(en.site.message.next) }));
    expect(await screen.findByText(en.site.message.emailInvalid)).toBeInTheDocument();
    fireEvent.change(email, { target: { value: "amina@example.org" } });
    fireEvent.click(screen.getByRole("button", { name: label(en.site.message.next) }));
    expect(await screen.findByLabelText(field(en.site.message.body))).toBeInTheDocument();
    expect(window.sessionStorage.getItem("praxis.site.message.email")).toBe("amina@example.org");
  });

  it("goes straight to the message when the session already knows the email", async () => {
    window.sessionStorage.setItem("praxis.site.message.email", "amina@example.org");
    await open();
    expect(await screen.findByLabelText(field(en.site.message.body))).toBeInTheDocument();
  });

  it("closes on Escape and hands focus back to the button", async () => {
    const { button, dialog } = await open();
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Escape" });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(button);
  });

  it("sends the message with the page it was written on, and shows the reference", async () => {
    window.sessionStorage.setItem("praxis.site.message.email", "amina@example.org");
    await open();
    const body = await screen.findByLabelText(field(en.site.message.body));
    // The timing trap refuses a send under 1.5 s after the form opened.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 5000);
    fireEvent.change(body, { target: { value: "Two 40 ft containers for Bangui." } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: label(en.site.message.send) }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByText("MSG-7Z3K9QW2")).toBeInTheDocument();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain("/public/intake/messages");
    expect(posts[0].body).toMatchObject({ email: "amina@example.org", message: "Two 40 ft containers for Bangui.", origin_page: "/" });
    expect(tc(en.site.message.sentTitle)).toBeTruthy();
  });
});

describe("the bot-check token store", () => {
  it("hands a token to one request only", () => {
    setHumanToken("message", "tok-1");
    expect(takeHumanToken("message")).toBe("tok-1");
    expect(takeHumanToken("message")).toBeNull();
  });
});
