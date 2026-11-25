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
        className="group btn-primary fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] right-3 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--brand-orange))] md:bottom-6 md:right-6"
      >
        <ChatGlyph />
        {/* Icon only at every width (owner's review of staging, 25 Nov 2026):
            the label was a second orange object competing with the page's
            own call to action. The aria-label names the button; this is the
            sighted equivalent, on hover and on keyboard focus, and hidden
            from assistive technology so the name is not announced twice. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--hero)] px-2.5 py-1.5 text-[0.8125rem] font-medium text-[var(--hero-foreground)] opacity-0 shadow-md group-hover:opacity-100 group-focus-visible:opacity-100 motion-safe:transition-opacity"
        >
          {t("site.message.open")}
        </span>
      </button>
      {open ? (
        <React.Suspense fallback={null}>
          <MessagePanel onClose={close} />
        </React.Suspense>
      ) : null}
    </>
  );
}
