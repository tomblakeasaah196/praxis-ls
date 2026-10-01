/**
 * "Open in Chrome to install" — shown on the sign-in and install surfaces when
 * the page is inside WhatsApp's, Facebook's, Instagram's, Telegram's or
 * LinkedIn's built-in browser, which cannot install the app (tenant review of
 * 29 Sep 2026, item 1.9). Android: one tap hands the page to Chrome through
 * the same `intent:` URL the open-in-browser bar uses. iPhone: the Safari
 * steps, because iOS offers no way to open Safari from a webview.
 */
import * as React from "react";
import { tr, tv } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { browserUrlFor } from "@/lib/installed-window";
import { inAppBrowser, isAndroidUa, isIosUa, type InAppBrowser } from "@/lib/in-app-browser";
import { cn } from "@/lib/cn";

export function InAppBrowserNotice({ className }: { className?: string }) {
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
  const openChrome = () => {
    window.location.href = browserUrlFor(window.location.href, ua);
  };
  return (
    <div
      role="region"
      aria-label={tr("Open in your browser")}
      data-testid="in-app-browser-notice"
      className={cn("rounded-xl border bg-popover p-3 text-sm text-foreground", className)}
    >
      <p className="font-medium">{tv("You are in {{app}}'s browser — it cannot install the app.", { app })}</p>
      {android ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={openChrome}>
            {tr("Open in Chrome to install")}
          </Button>
          <span className="text-xs text-muted-foreground">{tr("Sign in there, then add it to your home screen.")}</span>
        </div>
      ) : ios ? (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground">
          <li>{tr("Tap ⋯ (or the share button) and choose Open in Safari.")}</li>
          <li>{tr("In Safari, tap Share › Add to Home Screen.")}</li>
        </ol>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">{tr("Open this link in Chrome or Safari to install the app.")}</p>
      )}
    </div>
  );
}
