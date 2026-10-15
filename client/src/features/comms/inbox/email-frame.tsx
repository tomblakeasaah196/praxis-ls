/**
 * One email body, rendered in a sealed frame.
 *
 * ── WHY A FRAME ─────────────────────────────────────────────────────────────
 *
 * Gmail and Outlook keep a sender's inline styles and `<style>` blocks, and
 * both have to stop that CSS reaching their own screen. They do it by renaming
 * every class in the message (Gmail's prefix, Outlook's `x_`), which is a CSS
 * rewriter with all of a CSS rewriter's edge cases. A frame does the same job
 * with none of them: the message's stylesheet can only see the message. A
 * `position:fixed` box cannot cover the app, `body { … }` restyles nothing of
 * ours, and the reading pane went back to looking like the sender's email
 * rather than like ours with their words in it (owner decision, 15 Oct 2026).
 *
 * ── WHAT THE FRAME IS ALLOWED ───────────────────────────────────────────────
 *
 *   sandbox  `allow-same-origin` and the two popup tokens, and NOTHING else.
 *            No `allow-scripts`, so nothing in the message runs, whatever the
 *            sanitizer missed. Same-origin without scripts is what lets this
 *            component measure the document and hand it `blob:` images; the
 *            frame itself can do neither. Popups let a link open in a new tab
 *            (every link targets `_blank`, see the sanitizer), escaping the
 *            sandbox so the destination site works normally.
 *   CSP      its own, in the document: no script, no frames, no forms, inline
 *            styles only, and images from `data:` and `blob:` until the reader
 *            or a trusted sender allows `https:`. It sits on top of the app's
 *            own policy, which a `srcdoc` frame inherits. Anything the
 *            remote-content pass in `message-body.ts` misses is refused here.
 *
 * ── SIZE ────────────────────────────────────────────────────────────────────
 *
 * The frame is as tall as its content, so the conversation scrolls as one
 * page, the way a mail client reads. A message laid out wider than the column
 * (the 600px newsletter on a phone) is scaled down to fit, as the Gmail and
 * Outlook apps do, rather than clipped or given a scrollbar of its own.
 *
 * ── LINKS ───────────────────────────────────────────────────────────────────
 *
 * A `mailto:` opens the Praxis composer, as Outlook and Gmail open theirs
 * (owner decision), so the reply goes from a Praxis mailbox and lands in the
 * history. A `#anchor` scrolls within the message. Everything else opens in a
 * new tab with no referrer.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { buildSrcDoc, parseMailto, type EmailInk, type Mailto } from "./email-doc";

/** Below this the text is unreadable; a message wider than that is shown at this scale. */
const MIN_SCALE = 0.35;

/** Cross-realm safe: the event target is an element of the FRAME's document. */
function anchorOf(target: EventTarget | null): HTMLAnchorElement | null {
  const el = target as (Element & { closest?: (s: string) => Element | null }) | null;
  return el && typeof el.closest === "function" ? (el.closest("a[href]") as HTMLAnchorElement | null) : null;
}

export function EmailFrame({
  html,
  title,
  showRemote,
  ink,
  scheme,
  onMailto,
  className,
}: {
  /** Already sanitized on ingest and prepared by `renderBody`. */
  html: string;
  /** What a screen reader announces for the frame. */
  title: string;
  showRemote: boolean;
  ink: EmailInk;
  scheme: "light" | "dark";
  onMailto?: (m: Mailto) => void;
  className?: string;
}) {
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState<number | null>(null);
  const srcDoc = React.useMemo(() => buildSrcDoc(html, { showRemote, ink, scheme }), [html, showRemote, ink, scheme]);

  // Read through a ref so a new handler from the parent does not reload the frame.
  const onMailtoRef = React.useRef(onMailto);
  onMailtoRef.current = onMailto;

  React.useEffect(() => {
    const frame = ref.current;
    if (!frame) return undefined;
    let observer: ResizeObserver | null = null;
    let detach: (() => void) | null = null;

    const fit = () => {
      const doc = frame.contentDocument;
      const root = doc && doc.getElementById("pxm");
      if (!root) return;
      root.style.transform = "";
      root.style.width = "";
      const avail = frame.clientWidth;
      const natural = root.scrollWidth;
      if (avail > 0 && natural > avail + 1) {
        const scale = Math.max(MIN_SCALE, avail / natural);
        root.style.width = `${natural}px`;
        root.style.transformOrigin = "0 0";
        root.style.transform = `scale(${scale})`;
      }
      const next = Math.max(16, Math.ceil(root.getBoundingClientRect().height));
      setHeight((h) => (h !== null && Math.abs(h - next) <= 1 ? h : next));
    };

    const attach = () => {
      if (detach) detach();
      const doc = frame.contentDocument;
      if (!doc) return;
      const onClick = (e: MouseEvent) => {
        const a = anchorOf(e.target);
        if (!a) return;
        const href = a.getAttribute("href") || "";
        if (/^mailto:/i.test(href)) {
          e.preventDefault();
          if (onMailtoRef.current) onMailtoRef.current(parseMailto(href));
        } else if (href.startsWith("#")) {
          e.preventDefault();
          const id = href.slice(1);
          const target = doc.getElementById(id) || doc.getElementsByName(id)[0];
          if (target) target.scrollIntoView({ block: "start" });
        }
      };
      // Images and web fonts change the height after load; both bubble no
      // `load`, so it is caught on the way down.
      doc.addEventListener("load", fit, true);
      doc.addEventListener("error", fit, true);
      doc.addEventListener("click", onClick, true);
      const root = doc.getElementById("pxm");
      if (observer && root) observer.observe(root);
      detach = () => {
        doc.removeEventListener("load", fit, true);
        doc.removeEventListener("error", fit, true);
        doc.removeEventListener("click", onClick, true);
        if (observer && root) observer.unobserve(root);
      };
      fit();
    };

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => fit());
      observer.observe(frame);
    }
    frame.addEventListener("load", attach);
    if (frame.contentDocument && frame.contentDocument.readyState === "complete") attach();
    return () => {
      frame.removeEventListener("load", attach);
      if (detach) detach();
      if (observer) observer.disconnect();
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      scrolling="no"
      className={cn("block w-full border-0", className)}
      // Until it has measured itself: tall enough to show it is there, not so
      // tall that a two-line reply jumps the page when it lands.
      style={{ height: height === null ? 48 : height, colorScheme: scheme }}
    />
  );
}
