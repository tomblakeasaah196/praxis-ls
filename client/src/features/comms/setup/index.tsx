/**
 * Comms → Setup: how this company's email is configured, in two tabs split by
 * WHO is doing it.
 *
 * ── TWO TABS, AND WHAT HAPPENED TO THE OTHER EIGHT ──────────────────────────
 *
 * This page had ten tabs. The tenant review of 16 Nov 2026 was "ten different
 * screens for setup", "at most two tabs", and everything else cleared off.
 *
 *   My Mailbox     everyone. Your own address: connect it, test it, sync it,
 *                  disconnect it, and the shared mailboxes you can work.
 *   Company Mail   administrators. Every mailbox and who can work it, which
 *                  address each part of the product sends from, and the system
 *                  email login. One page, three sections.
 *
 * Where the rest went:
 *
 *   Connections        folded into My Mailbox. It listed the same mailboxes a
 *                      third way; its Test, Sync Now and Edit Settings are now
 *                      on the mailbox they act on.
 *   Mailboxes          the first section of Company Mail.
 *   Send Points        the second section, one row per section of the product.
 *   Senders & Channels the third section, as System Email.
 *   Test Calls         Settings → Calls. It was the one tab not about email.
 *   Follow-ups, Secure Links, Response Times, Trust & Archives
 *                      removed from the product's screens by the review. Their
 *                      endpoints are untouched.
 *
 * A non-administrator sees ONE tab and therefore no tab strip at all: a strip
 * with a single item is noise. What they may do is answered by the server
 * (`GET /mail/me`) rather than guessed from the modules they can read: read
 * visibility is not the same right as edit, and a tab that always 403s teaches
 * people to distrust the tabs that work. The API remains the authority; this
 * only decides what is offered.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Callout } from "@/components/ui/callout";
import { useResource } from "@/lib/use-resource";
import { tr } from "@/lib/i18n";
import * as api from "@/lib/mail-api";
import { MyMailboxTab } from "./my-mailbox";
import { MailboxesTab } from "./mailboxes";
import { SendPointsSection } from "./send-points";
import { SystemEmailSection } from "../setup";

type TabKey = "mine" | "company";

const TABS: { key: TabKey; label: string; adminOnly: boolean }[] = [
  { key: "mine", label: "My Mailbox", adminOnly: false },
  { key: "company", label: "Company Mail", adminOnly: true },
];

export function CommsSetupPage() {
  const caps = useResource(() => api.mailCapabilities(), []);
  // Until the answer arrives, offer only the tab everyone has. Over-offering for
  // a frame and then retracting is worse than a tab appearing a moment later.
  const isAdmin = caps.data?.can_administer === true;
  const visible = TABS.filter((t) => !t.adminOnly || isAdmin);

  /**
   * Creating a shared mailbox is MOD-72 **create**, which is a different right
   * from the `can_administer` (= edit) that decides whether the tab is offered
   * at all.
   */
  const canCreate = caps.data?.can_create === true;

  const [tab, setTab] = React.useState<TabKey>("mine");
  React.useEffect(() => {
    if (!visible.some((t) => t.key === tab)) setTab("mine");
  }, [visible, tab]);

  /**
   * ── WHERE A MICROSOFT CONSENT ROUND TRIP LANDS ──────────────────────────
   *
   * A person leaves this page for Microsoft, approves, and comes back to a
   * bare redirect: no session state, no memory of which tab asked, and the
   * result of the whole thing sitting in a query string. That result has to be
   * SAID — a mailbox either connected or it did not — and it has to be said on
   * the tab that asked, or an administrator who set up `operations@` reads a
   * success message on a screen about their own mailbox.
   *
   * The callback used to redirect to `/comms/mail`, which renders the inbox and
   * mounts none of this: the message was written and nothing displayed it. It
   * now lands here, carrying `mail_tab` — which the server derives from the
   * SIGNED OAuth state rather than from anything the browser sent. It is an
   * ordinary query parameter by the time it arrives, so a hand-typed one is
   * possible and harmless: it can only select a tab this user is already
   * offered, since the guard effect above bounces any other back to "mine".
   *
   * Read once, then stripped from the URL, so a reload does not replay a
   * success banner for a mailbox connected ten minutes ago.
   */
  const [oauthNote, setOauthNote] = React.useState<
    { ok: boolean; tone?: "warn" | "info"; text: string; code?: string | null } | null
  >(null);
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const ok = p.get("mail_connected");
    const bad = p.get("mail_error");
    const consent = p.get("mail_adminconsent");
    if (!ok && !bad && !consent) return;
    const who = (ok || p.get("provider")) === "google" ? "Google" : "Microsoft";
    if (ok) {
      const email = p.get("email");
      setOauthNote({
        ok: true,
        text: `${tr("Connected to")} ${who}${email ? ` — ${email}` : ""}. ${tr("Mail starts arriving within a minute or two.")}`,
      });
    } else if (consent === "granted") {
      // The administrator pressed Accept in Entra: consent is recorded in
      // THEIR directory, and the mailbox that was refused can now connect.
      setOauthNote({
        ok: true,
        text: tr("Admin consent recorded in Microsoft 365. Connect the mailbox again: it should go through now."),
      });
    } else if (consent === "denied") {
      setOauthNote({
        ok: false,
        tone: "warn",
        code: "MS_CONSENT_DENIED",
        text: tr("The administrator did not grant consent, so Microsoft mailboxes from that organisation still cannot connect. Nothing was changed."),
      });
    } else {
      // Named failures carry their remedy; unknown codes keep the old generic
      // wording with the code in parens for support. A cancel is not an error.
      const guidance: Record<string, { tone?: "warn" | "info"; text: string }> = {
        OAUTH_CANCELLED: {
          tone: "info",
          text: who === "Google"
            ? tr("The connection was cancelled at Google's sign-in screen. Nothing was changed: try again whenever you are ready.")
            : tr("The connection was cancelled at Microsoft's sign-in screen. Nothing was changed: try again whenever you are ready."),
        },
        GOOGLE_BAD_CLIENT: {
          text: tr("Google rejected the platform's OAuth client: the client ID or secret is wrong. This is not something retrying fixes: an administrator needs to check Platform Console → Integrations → Google Workspace / Gmail."),
        },
        GOOGLE_REDIRECT_MISMATCH: {
          text: tr("Google rejected the return address for this sign-in. An administrator needs to check that the redirect URI on the Google OAuth client matches Platform Console → Integrations → Google Workspace / Gmail."),
        },
        GOOGLE_GRANT_EXPIRED: {
          tone: "warn",
          text: tr("Google did not accept that sign-in because it had already been used or had expired. Connect the mailbox again."),
        },
        GOOGLE_AUTH_FAILED: {
          text: tr("Google refused the sign-in. Try again; if it keeps failing, note the time and ask an administrator to check the mail logs."),
        },
        MS_CONSENT_REQUIRED: {
          tone: "warn",
          text: tr("Your organisation requires an administrator's approval before anyone may connect a mailbox. Ask your Microsoft 365 administrator to open the consent link below (or grant it in Entra → Enterprise applications → Permissions), then connect again."),
        },
        MS_BAD_SECRET: {
          text: tr("Microsoft rejected the platform's app credentials: the client secret is wrong or has expired. This is not something retrying fixes: an administrator needs to check Platform Console → Integrations → Microsoft 365."),
        },
        MS_REDIRECT_MISMATCH: {
          text: tr("Microsoft rejected the return address for this sign-in. An administrator needs to check that the Redirect URI registered on the Entra app matches Platform Console → Integrations → Microsoft 365."),
        },
        MS_AUTH_FAILED: {
          text: tr("Microsoft refused the sign-in. Try again; if it keeps failing, note the time and ask an administrator to check the mail logs."),
        },
      };
      const g = bad ? guidance[bad] : undefined;
      setOauthNote({
        ok: false,
        tone: g?.tone,
        code: bad,
        text: g
          ? g.text
          : `${who} ${tr("did not connect the mailbox")} (${bad}). ${tr("Nothing was changed: try again, or connect it with its own server settings instead.")}`,
      });
    }
    // The server still says "mailboxes" for a team address: that is the name
    // the signed OAuth state was minted with, and it means Company Mail here.
    const wanted = p.get("mail_tab");
    if (wanted === "mailboxes") setPendingTab("company");
    else if (wanted === "mine") setPendingTab("mine");
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // The consent link opens in a NEW tab: it is for the organisation's M365
  // administrator, who may be a different person on this same machine, and
  // navigating this page away would strand the operator mid-setup.
  const [consentBusy, setConsentBusy] = React.useState(false);
  const openAdminConsent = React.useCallback(() => {
    setConsentBusy(true);
    api
      .microsoftAdminConsent()
      .then((r) => {
        window.open(r.url, "_blank", "noopener,noreferrer");
      })
      .catch(() => {
        setOauthNote({
          ok: false,
          code: "MS_CONSENT_REQUIRED",
          text: tr("Could not build the consent link. Try again in a moment. Your administrator can also grant consent directly in Entra → Enterprise applications → Permissions."),
        });
      })
      .finally(() => setConsentBusy(false));
  }, []);

  /**
   * HELD until the tab is actually offered, rather than selected on the spot.
   *
   * `visible` is derived from `GET /mail/me`, which has not answered on the
   * frame this component mounts — so "Company Mail" is not in it yet, and the
   * guard effect above, whose whole job is to bounce an impossible tab back to
   * "mine", would immediately undo the selection. Setting it a frame later,
   * once the capability answer has arrived, is the difference between an
   * administrator landing on the Company Mail tab they started from and landing on
   * their own mailbox with a message about a team address.
   *
   * Cleared once applied, so it is a one-shot and not a tab the user cannot
   * navigate away from.
   */
  const [pendingTab, setPendingTab] = React.useState<TabKey | null>(null);
  React.useEffect(() => {
    if (!pendingTab) return;
    if (!visible.some((t) => t.key === pendingTab)) return;
    setTab(pendingTab);
    setPendingTab(null);
  }, [pendingTab, visible]);

  /**
   * Rendered by whichever tab the round trip came back to, rather than above
   * the tab strip: the answer belongs beside the button that asked the
   * question. Only one tab is mounted at a time, so only one can show it.
   */
  const notice = oauthNote ? (
    <Callout
      tone={oauthNote.ok ? "ok" : oauthNote.tone || "bad"}
      action={
        <span className="flex items-center gap-3">
          {/* Only on the failure this button can fix: an admin-consent link
              next to any other error would send the administrator to approve
              something that was never the problem. */}
          {oauthNote.code === "MS_CONSENT_REQUIRED" && (
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              disabled={consentBusy}
              onClick={openAdminConsent}
            >
              {consentBusy ? tr("Opening…") : tr("Open admin consent")}
            </button>
          )}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => setOauthNote(null)}
          >
            {tr("Dismiss")}
          </button>
        </span>
      }
    >
      {oauthNote.text}
    </Callout>
  ) : null;

  return (
    <div className="space-y-4">
      {visible.length > 1 && (
        <nav
          className="flex flex-wrap items-end gap-1 border-b border-border"
          aria-label={tr("Email setup sections")}
        >
          {visible.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 pb-2 pt-1 text-sm font-medium transition-colors",
                tab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {tr(t.label)}
            </button>
          ))}
        </nav>
      )}

      {tab === "mine" && <MyMailboxTab notice={notice} />}
      {tab === "company" && isAdmin && (
        <div className="space-y-5">
          <MailboxesTab canCreate={canCreate} notice={notice} />
          <SendPointsSection />
          <SystemEmailSection />
        </div>
      )}
    </div>
  );
}
