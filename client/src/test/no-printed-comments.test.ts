/**
 * A comment written between two JSX elements is TEXT: React prints it. A block comment with the
 * "@prose:keep" marker, on a line of its own after a closing tag, appeared on My Security's passkey
 * card, under the heading, for every person who opened the page. In JSX children a comment has to
 * be wrapped in braces.
 *
 * The check is the one shape that went wrong: a line that is nothing but a block comment, directly
 * after a line ending in ">" (a closing tag), outside braces. A comment after "? (", "&& (" or
 * "=> (" is JavaScript, not text, and follows a line ending in something else, so it passes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

describe("comments in JSX", () => {
  it("none sits between two elements outside braces, where React would print it", () => {
    const printed: string[] = [];
    for (const file of sources(join(__dirname, ".."))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!/^\s+\/\*[^}]*\*\/\s*$/.test(line)) return;
        let j = i - 1;
        while (j >= 0 && !lines[j].trim()) j -= 1;
        const before = j >= 0 ? lines[j].trimEnd() : "";
        if (before.endsWith(">") && !before.endsWith("=>")) printed.push(`${file.split("/src/")[1]}:${i + 1}`);
      });
    }
    expect(printed).toEqual([]);
  });
});
