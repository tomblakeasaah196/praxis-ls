import { describe, expect, it } from "vitest";
import { coverKey, isImageFile, sortImportFiles } from "./website-insight-import";

/**
 * The import's one selection: Markdown and cover images together. The cases
 * that matter are the ones where a cover would silently miss its article.
 */
const f = (name: string, type = "") => ({ name, type });

describe("sorting one selection", () => {
  it("separates articles, covers and anything else", () => {
    const { markdown, images, other } = sortImportFiles([
      f("01-why.md"),
      f("01-why.md", "text/markdown"),
      f("a01-why.jpg", "image/jpeg"),
      f("a02.webp"), // Windows reports no type for .webp
      f("a03.PNG", "image/png"),
      f("INDEX.txt", "text/plain"),
      f("notes.pdf", "application/pdf"),
    ]);
    expect(markdown.map((x) => x.name)).toEqual(["01-why.md", "01-why.md", "INDEX.txt"]);
    expect(images.map((x) => x.name)).toEqual(["a01-why.jpg", "a02.webp", "a03.PNG"]);
    expect(other.map((x) => x.name)).toEqual(["notes.pdf"]);
  });

  it("does not take a GIF or an SVG as a cover", () => {
    expect(isImageFile(f("x.gif", "image/gif"))).toBe(false);
    expect(isImageFile(f("x.svg", "image/svg+xml"))).toBe(false);
  });
});

describe("matching a cover to its article", () => {
  it("ignores case, folders and the extension", () => {
    const key = coverKey("a01-why-we-started-with-customs.jpg");
    expect(coverKey("A01-Why-We-Started-With-Customs.JPG")).toBe(key);
    expect(coverKey("covers/a01-why-we-started-with-customs.jpg")).toBe(key);
    // The upload engine may re-encode a JPEG as WebP and rename it.
    expect(coverKey("a01-why-we-started-with-customs.webp")).toBe(key);
  });

  it("keeps different covers apart", () => {
    expect(coverKey("a01-a.jpg")).not.toBe(coverKey("a01-b.jpg"));
  });

  it("is empty for nothing", () => {
    expect(coverKey(null)).toBe("");
  });
});
