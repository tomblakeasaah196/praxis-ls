import * as React from "react";
import { useTranslation } from "react-i18next";

/**
 * The floating message button, on every marketing page (SmartLS website v2,
 * PR 2; mounted once in `PageShell`, never in the portal, which has its own
 * conversation with the desk).
 *
 * This file is only the launcher, and it is small on purpose: it is in every
 * visitor's download. The panel (`message-panel.tsx`: email first, then the
 * message, files and the bot check) loads when the visitor reaches for the
 * button, ahead of the click on hover or focus.
 *
 * On a phone the button is a 48px circle in the corner, and a spacer the same
 * height closes the page, so when the visitor reaches the bottom the button
 * sits over that spacer rather than over the last line of the footer.
 */

const loadPanel = () => import("./message-panel");
const MessagePanel = React.lazy(loadPanel);

function ChatGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
      <path d="M8.5 11h7M8.5 14h4" />
    </svg>
  );
}

export function MessageButton() {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const launcher = React.useRef<HTMLButtonElement>(null);

  const close = React.useCallback(() => {
    setOpen(false);
    // Back to where the visitor was: the button that opened the panel.
    requestAnimationFrame(() => launcher.current?.focus());
  }, []);

  return (
    <>
      <div aria-hidden="true" className="h-16 md:hidden" />
      <button
        ref={launcher}
        type="button"
        aria-label={t("site.message.open")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "site-message-panel" : undefined}
        onClick={() => setOpen((v) => !v)}
        onPointerEnter={() => void loadPanel()}
        onFocus={() => void loadPanel()}
        className="btn-primary fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] right-3 z-40 inline-flex h-12 min-w-[3rem] items-center justify-center gap-2 rounded-full px-3 text-[0.9375rem] font-semibold shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--brand-orange))] md:bottom-6 md:right-6 md:px-5"
      >
        <ChatGlyph />
        {/* Shown from md up; the button's aria-label names it at every width.
            Not `sr-only md:not-sr-only`: this site's `.sr-only` also sets a
            clip-path that Tailwind's reset leaves in place, so the words were
            announced but never drawn (found on staging, 25 Nov 2026). */}
        <span aria-hidden="true" className="hidden md:inline">{t("site.message.open")}</span>
      </button>
      {open ? (
        <React.Suspense fallback={null}>
          <MessagePanel onClose={close} />
        </React.Suspense>
      ) : null}
    </>
  );
}
