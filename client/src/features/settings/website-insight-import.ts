/**
 * The Import dialog's file sorting: which picked files are articles and which
 * are covers, and which cover belongs to which article.
 *
 * Its own module, not beside the dialog, so it can be tested without rendering
 * and so the dialog file exports only components (Fast Refresh).
 *
 * ── WHY COVERS TRAVEL WITH THE ARTICLES ────────────────────────────────────
 * A library imported as text still needed a cover uploaded article by
 * article, which is the clicking the import exists to remove. Each Markdown
 * file names its image in `cover:`; the writer selects the whole folder once
 * (Markdown and images together), and each image goes to the article whose
 * front matter names it. An image no article names is shown as not imported,
 * never dropped in silence.
 */

const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const MARKDOWN_EXT = /\.(md|markdown)$/i;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** What the file picker offers: Markdown and the three cover formats. */
export const IMPORT_ACCEPT =
  ".md,.markdown,text/markdown,text/plain,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

/** An image is judged by its type, or by its extension when the browser
 *  reports no type (Windows does this for .webp). The server sniffs the bytes
 *  either way; this only decides which queue a file joins. */
export const isImageFile = (f: Pick<File, "name" | "type">): boolean =>
  IMAGE_TYPES.includes((f.type || "").toLowerCase()) || (!f.type && IMAGE_EXT.test(f.name));

export const isMarkdownFile = (f: Pick<File, "name" | "type">): boolean =>
  MARKDOWN_EXT.test(f.name) || (f.type || "").toLowerCase() === "text/markdown";

/** The key a cover is matched on: the bare file name without its extension,
 *  case folded. The front matter says `a01-why-we-started-with-customs.jpg`;
 *  Windows may hand the picker `A01-Why-We-Started-With-Customs.JPG`; and the
 *  upload engine may re-encode a large JPEG as WebP and rename it to match. All
 *  three are the same cover. */
export const coverKey = (name: string | null | undefined): string =>
  String(name || "")
    .split(/[\\/]/)
    .pop()!
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase();

/** Split one selection into articles, covers and anything else. */
export function sortImportFiles<F extends Pick<File, "name" | "type">>(files: F[]) {
  const markdown: F[] = [];
  const images: F[] = [];
  const other: F[] = [];
  for (const f of files) {
    if (isImageFile(f)) images.push(f);
    else if (isMarkdownFile(f) || (f.type || "").toLowerCase() === "text/plain") markdown.push(f);
    else other.push(f);
  }
  return { markdown, images, other };
}
