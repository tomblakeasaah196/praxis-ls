import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
/* For its side effect: `lib/i18n` initialises i18next on import. */
import "@/lib/i18n";
import { MessageButton } from "@/components/site/message-button";
import { en } from "@/lib/i18n-dict";

/**
 * The message button waits until the visitor is past the first screen.
 *
 * The owner's phone screenshots (25 Nov 2026): the floating button sat on the
 * hero's own text, and the hero already offers Contact Us. Pinned: hidden at
 * the top, shown past the hero (or one viewport without one), latched once
 * shown, and at once, without the fade, for a visitor who arrives mid-page.
 */

const VH = 800;
let scrollY = 0;

const setScroll = (y: number) => {
  scrollY = y;
};
const scroll = async (y: number) => {
  setScroll(y);
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
  });
};
const button = () => screen.getByRole("button", { name: new RegExp(`^${en.site.message.open}$`, "i") });

/** A hero band of the given height at the top of <main>, positioned against the scroll. */
function withHero(height: number) {
  const main = document.createElement("main");
  const hero = document.createElement("section");
  hero.className = "band-hero";
  hero.getBoundingClientRect = () =>
    ({ top: -scrollY, bottom: height - scrollY, height, left: 0, right: 0, width: 0, x: 0, y: -scrollY, toJSON() {} }) as DOMRect;
  main.appendChild(hero);
  document.body.appendChild(main);
  return () => main.remove();
}

beforeEach(() => {
  scrollY = 0;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: VH });
});
afterEach(() => vi.restoreAllMocks());

describe("the message button's arrival", () => {
  it("waits on the first screen of a page with no hero, then shows past one viewport", async () => {
    render(<MessageButton />);
    expect(button()).toHaveAttribute("data-state", "waiting");
    await scroll(VH - 1);
    expect(button()).toHaveAttribute("data-state", "waiting");
    await scroll(VH);
    expect(button()).toHaveAttribute("data-state", "shown");
  });

  it("measures against the hero when there is one", async () => {
    const remove = withHero(1100);
    render(<MessageButton />);
    await scroll(VH + 50);
    // Past one viewport, but the hero's bottom is still on screen.
    expect(button()).toHaveAttribute("data-state", "waiting");
    await scroll(1100);
    expect(button()).toHaveAttribute("data-state", "shown");
    remove();
  });

  it("stays once it has shown, and fades in for a visitor who scrolled", async () => {
    const now = performance.now();
    render(<MessageButton />);
    // Well after load: the visitor's own scroll, not a restored position.
    vi.spyOn(performance, "now").mockReturnValue(now + 5000);
    await scroll(VH * 2);
    expect(button()).toHaveAttribute("data-state", "shown");
    expect(button()).not.toHaveAttribute("data-instant");
    await scroll(0);
    expect(button()).toHaveAttribute("data-state", "shown");
  });

  it("is there at once, without the fade, for a visitor who lands mid-page", async () => {
    setScroll(VH * 3);
    render(<MessageButton />);
    expect(button()).toHaveAttribute("data-state", "shown");
    expect(button()).toHaveAttribute("data-instant", "true");
  });

  it("keeps its name, and stays shown while its panel is open", async () => {
    render(<MessageButton />);
    expect(button()).toHaveAccessibleName(new RegExp(`^${en.site.message.open}$`, "i"));
    await act(async () => {
      fireEvent.click(button());
    });
    expect(button()).toHaveAttribute("data-state", "shown");
  });
});
