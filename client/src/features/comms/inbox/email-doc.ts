/**
 * The document a sealed email frame renders, and the `mailto:` links in it.
 *
 * Pure functions, apart from `email-frame.tsx` so the component file exports
 * only the component (fast refresh) and so the frame's Content-Security-Policy
 * can be asserted without mounting anything. See `email-frame.tsx` for why the
 * frame exists and what it is allowed.
 */

/** The tenant colours a message is drawn against, read from the live tokens. */
export type EmailInk = {
  /** Text with no colour of its own. */
  fg: string;
  /** Links with no colour of their own. */
  link: string;
  /** The quote bar and other rules. */
  rule: string;
  /** The app's own font stack, for a message that names none. */
  font: string;
};

export type Mailto = { to: string[]; cc: string[]; subject: string | null; body: string | null };

/** `mailto:a@x,b@x?cc=c@x&subject=Hi` → its parts. Anything malformed is just an address. */
export function parseMailto(href: string): Mailto {
  const raw = href.replace(/^mailto:/i, "");
  const q = raw.indexOf("?");
  const path = q === -1 ? raw : raw.slice(0, q);
  const params = new URLSearchParams(q === -1 ? "" : raw.slice(q + 1));
  const split = (v: string | null) =>
    (v ? safeDecode(v) : "").split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  return {
    to: split(path),
    cc: split(params.get("cc")),
    subject: params.get("subject"),
    body: params.get("body"),
  };
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v; /* @silent:parse a malformed escape is read as written */
  }
}

/** The document the frame renders. Exported so the policy can be asserted. */
export function buildSrcDoc(
  html: string,
  { showRemote, ink, scheme }: { showRemote: boolean; ink: EmailInk; scheme: "light" | "dark" },
): string {
  const remote = showRemote ? " https:" : "";
  const csp = [
    "default-src 'none'",
    `img-src data: blob:${remote}`,
    "style-src 'unsafe-inline'",
    `font-src data:${remote}`,
    "media-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
  ].join("; ");
  // The page is transparent: the message block behind it is the surface, so a
  // read message (a dimmer card) and an unread one look as they always did.
  // A message that paints its own background paints it, recoloured or not.
  const base = [
    `html{color-scheme:${scheme}}`,
    "html,body{margin:0;padding:0;background:transparent;overflow:hidden}",
    `body{color:${ink.fg};font-family:${ink.font};font-size:14px;line-height:1.5;overflow-wrap:break-word;-webkit-text-size-adjust:100%}`,
    "#pxm{display:flow-root}",
    `a{color:${ink.link}}`,
    `blockquote{margin:0 0 0 .8ex;padding-left:1ex;border-left:1px solid ${ink.rule}}`,
    "pre{white-space:pre-wrap}",
    "img{border:0}",
  ].join("");
  return (
    "<!doctype html><html><head><meta charset=\"utf-8\">"
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<meta name="color-scheme" content="${scheme}">`
    + "<base target=\"_blank\">"
    + `<style>${base}</style>`
    + `</head><body><div id="pxm">${html}</div></body></html>`
  );
}
