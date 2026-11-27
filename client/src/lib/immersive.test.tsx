import { describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { useImmersive, useIsImmersive } from "./immersive";

function Raise({ on }: { on: boolean }) {
  useImmersive(on);
  return null;
}
function Read({ out }: { out: boolean[] }) {
  out.push(useIsImmersive());
  return null;
}

describe("immersive mode", () => {
  it("is a counter: two screens raising it cannot lower it for each other", () => {
    const out: boolean[] = [];
    const view = render(
      <>
        <Raise on />
        <Raise on />
        <Read out={out} />
      </>,
    );
    expect(out.at(-1)).toBe(true);
    act(() =>
      view.rerender(
        <>
          <Raise on={false} />
          <Raise on />
          <Read out={out} />
        </>,
      ),
    );
    expect(out.at(-1)).toBe(true);
    act(() =>
      view.rerender(
        <>
          <Raise on={false} />
          <Raise on={false} />
          <Read out={out} />
        </>,
      ),
    );
    expect(out.at(-1)).toBe(false);
  });

  it("is lowered when the screen that raised it unmounts", () => {
    const out: boolean[] = [];
    const view = render(
      <>
        <Raise on />
        <Read out={out} />
      </>,
    );
    expect(out.at(-1)).toBe(true);
    act(() => view.rerender(<Read out={out} />));
    expect(out.at(-1)).toBe(false);
  });
});
