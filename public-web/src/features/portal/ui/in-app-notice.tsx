/**
 * "Open in Chrome to install" for the client portal (tenant review of 29 Sep
 * 2026, item 1.9) — on the sign-in page and the Account screen's install card
 * when the portal is open inside WhatsApp's, Facebook's, Instagram's,
 * Telegram's or LinkedIn's own browser, where it cannot be installed and its
 * notifications would die with the webview. Android hands the page to Chrome
 * (the open-in-browser bar's `intent:` URL); an iPhone gets the Safari steps.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { browserUrlFor } from "@/lib/installed-window";
import { inAppBrowser, isAndroidUa, isIosUa, type InAppBrowser } from "@/lib/in-app-browser";

export function PortalInAppNotice({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const [app, setApp] = React.useState<InAppBrowser | null>(null);
  const [ua, setUa] = React.useState("");
  React.useEffect(() => {
    const agent = typeof navigator !== "undefined" ? navigator.userAgent : "";
    setUa(agent);
    setApp(inAppBrowser(agent));
  }, []);
  if (!app) return null;
  const android = isAndroidUa(ua);
  const ios = isIosUa(ua);
  return (
    <div role="region" aria-label={t("portal.install.inAppChrome")} data-testid="portal-in-app-notice" className={`pt-card p-3 text-sm ${className}`}>
      <p className="font-semibold text-foreground">{t("portal.install.inAppTitle", { app })}</p>
      {android ? (
        <div className="mt-2 grid gap-1">
          <button
            type="button"
            className="pt-btn pt-btn-primary pt-btn-sm justify-self-start"
            onClick={() => {
              window.location.href = browserUrlFor(window.location.href, ua);
            }}
          >
            {t("portal.install.inAppChrome")}
          </button>
          <span className="text-xs text-muted-foreground">{t("portal.install.inAppAndroidHint")}</span>
        </div>
      ) : ios ? (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
          <li>{t("portal.install.inAppIos1")}</li>
          <li>{t("portal.install.inAppIos2")}</li>
        </ol>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">{t("portal.install.inAppOther")}</p>
      )}
    </div>
  );
}
