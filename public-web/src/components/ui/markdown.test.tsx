import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "./markdown";

/**
 * Bullets in tenant copy, and the CSS that draws them.
 *
 * The preflight sets `list-style: none` on every `ul` and `ol`. That is right
 * for a nav, a card grid or a footer, and it means a list in tenant-written copy
 * has markers only where a stylesheet hands them back. On 27 Nov 2026 a job
 * advert on the live site printed its bullets as indented paragraphs with no
 * markers: `.prose-site` set the margins and the indent and never the marker.
 *
 * jsdom applies no stylesheet here (`css: false`), so the marker itself cannot
 * be measured. What is pinned instead is the chain that produces it: the
 * renderer emits real lists, each wrapper a visitor reads markdown in gives
 * those lists a marker, and every `<Markdown>` on a page sits inside one of
 * those wrappers.
 */

const SRC = join(__dirname, "..", "..");

/** The wrappers that style rendered markdown, and the stylesheet each lives in. */
const WRAPPERS: Record<string, string> = {
  "prose-site": join(SRC, "index.css"),
  "doc-body": join(SRC, "components", "site", "brand.css"),
};

/**
 * The `list-style` (or `list-style-type`) a selector ends up with in one file:
 * the last declaration wins, which is the cascade for equal specificity.
 * Comments go first, because a brace inside one would split a rule.
 */
function listStyleOf(file: string, selector: string): string | null {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  let value: string | null = null;
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(",").map((s) => s.trim()).includes(selector)) continue;
    const m = /(?:^|[;\s])list-style(?:-type)?\s*:\s*([^;]+)/.exec(body);
    if (m) value = m[1].trim();
  }
  return value;
}

describe("Markdown lists", () => {
  it("renders bullets and numbers as real lists", () => {
    const { container } = render(
      <Markdown text={"- Five years in clearing\n- A driving licence\n\n1. Apply\n2. Interview"} />,
    );
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
  });

  it.each(Object.entries(WRAPPERS))("`.%s` gives its lists a marker", (cls, file) => {
    // `revert` is the browser's own default (a disc, a number); an explicit
    // `disc` and `decimal` say the same thing longhand. A bullet list must not
    // come out numbered, and `none` is the bug.
    expect(["disc", "revert"]).toContain(listStyleOf(file, `.${cls} ul`));
    expect(["decimal", "revert"]).toContain(listStyleOf(file, `.${cls} ol`));
  });

  it("is rendered inside one of those wrappers wherever a visitor reads it", () => {
    const sites: Array<{ file: string; wrapper: string }> = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.isFile() || !/\.tsx$/.test(entry.name) || /\.test\.tsx$/.test(entry.name)) {
          continue;
        }
        // Block comments out first: a doc comment that names `<Markdown>` is
        // not a call.
        const text = readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        for (const m of text.matchAll(/<Markdown[\s>]/g)) {
          // The nearest className before the call, and nothing closed between
          // the two: the element that holds the rendered copy.
          const before = text.slice(0, m.index);
          const at = before.lastIndexOf("className=");
          const closed = at < 0 || before.slice(at).includes("</");
          sites.push({
            file: relative(SRC, full).replace(/\\/g, "/"),
            wrapper: closed ? "" : before.slice(at, at + 120),
          });
        }
      }
    };
    walk(SRC);

    // Derived, not listed, so a page added tomorrow is checked too. The careers
    // advert is where the bug was seen, so it must be among what was found.
    expect(sites.map((s) => s.file)).toContain("features/careers/careers-page.tsx");
    const unwrapped = sites.filter(
      (s) => !Object.keys(WRAPPERS).some((cls) => s.wrapper.includes(cls)),
    );
    expect(unwrapped).toEqual([]);
  });
});
