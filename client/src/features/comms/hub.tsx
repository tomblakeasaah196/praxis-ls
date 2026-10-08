/**
 * Comms — the single Messaging workstation:
 *   /comms        → unified inbox / team chat (individual + group channels)
 *   /comms/mail   → the mailbox: the PR-1 unified inbox (threads, folders,
 *                   search, the Master Composer). Connecting and managing
 *                   mailboxes (Microsoft 365 / Google / IMAP-SMTP) lives under
 *                   Comms → Setup.
 *   /comms/clients → the Client inbox: every client's portal conversations,
 *                   waiting first (client portal PR 3, MOD-64C).
 *   /comms/calls  → the user's calls, and /comms/calls/:callId one call's
 *                   summary and transcript. Call settings live at
 *                   /settings/calls.
 *   /comms/setup  → everything about how email is configured, in sub-tabs:
 *                   My mailbox (everyone) · Mailboxes, Send points and
 *                   Senders & channels (administrators). PR-0 moved tenant mail
 *                   configuration here rather than into Settings: it used to be
 *                   spread across three surfaces and nobody could find it.
 *
 * The hub draws its own Chat / Mailbox / Setup tab bar: `areas.ts` defines no
 * sections for Comms (so the ribbon's second row carries nothing here), and the
 * mailbox is a product surface that used to be reachable only by URL. The bar
 * is persistent — every page keeps it, so Mailbox is always one click away.
 */
import { useParams, NavLink } from "react-router-dom";
import { cn } from "@/lib/cn";
import { pageShell } from "@/lib/layout";
import { TeamChatPage } from "./team-chat";
import { InboxPage } from "./inbox";
import { CommsSetupPage } from "./setup/index";
import { SignaturesPage } from "./signatures";
import { CallsListPage } from "./call/calls-list";
import { CallRecordPage } from "./call/call-record";
import { useCallCapabilities } from "./call/call-capabilities";
import { ClientInboxPage } from "./client-inbox";
import { useCanUseModule } from "@/lib/route-access";

const TABS = [
  { to: "/comms", label: "Chat", end: true },
  { to: "/comms/mail", label: "Mailbox", end: false },
  // Client portal PR 3: every client's portal conversations (MOD-64C).
  { to: "/comms/clients", label: "Clients", end: false },
  { to: "/comms/signatures", label: "Signatures", end: false },
  { to: "/comms/calls", label: "Calls", end: false },
  { to: "/comms/setup", label: "Setup", end: false },
] as const;

export function CommsHub() {
  const { section: sectionParam, callId } = useParams();
  // `/comms/calls/:callId` has no `:section`; it is the Calls tab all the same.
  const section = callId ? "calls" : sectionParam;
  const isChat = !section || !["setup", "signatures", "mail", "calls", "clients"].includes(section);
  /* The mailbox is a three-pane workstation from `lg` up and a scrolling page
     below it, so every class below is `lg:`-prefixed.
     
     The chain has to run unbroken from <main> to the pane that actually
     scrolls: <main> is already `min-h-0 flex-1 overflow-y-auto`, and from
     there it is this section, the page, the grid, the pane column, SplitPane
     and finally ThreadList / ThreadView. One `height: auto` link anywhere
     along it and `flex-1` becomes `flex-basis: 0` against an unconstrained
     parent, every `overflow-y-auto` below stops doing anything, and the panes
     go back to growing to their content, which is the defect this screen
     shipped with.
     
     <main> needs NO change for this, which was worth checking rather than
     assuming: an `overflow-hidden` was tried there first, on the model of the
     chat workstation, and measured to do nothing — the chain sizes the content
     to exactly <main>'s box, so it never scrolls. Keeping it would have cost
     something, too: `<PullToRefresh>` arms when its scroll container is at the
     top, and a <main> that can never scroll is a <main> that is always at the
     top, so the pull would be live under every swipe on a touch screen wide
     enough to get the three panes. e2e/mail-workstation.spec.ts asserts that
     <main> does not scroll, which is the property, rather than the class that
     was going to force it. */
  const isMail = section === "mail";
  // F10: no Calls tab while the tenant has calls off. A deep link to a call
  // still opens it — its record answers for itself.
  const callsOn = useCallCapabilities()?.calls === true;
  // The Client inbox only for the people who answer clients; a deep link from
  // an alert still opens it, and the API answers for itself.
  const inboxOn = useCanUseModule("MOD-64C");
  const tabs = TABS.filter(
    (t) =>
      (t.to !== "/comms/calls" || callsOn || section === "calls") &&
      (t.to !== "/comms/clients" || inboxOn || section === "clients"),
  );
  const page =
    section === "setup" ? (
      <CommsSetupPage />
    ) : section === "calls" ? (
      callId ? <CallRecordPage /> : <CallsListPage />
    ) : section === "clients" ? (
      <section className={pageShell.wide}>
        <ClientInboxPage />
      </section>
    ) : section === "signatures" ? (
      <SignaturesPage />
    ) : section === "mail" ? (
      /* The legacy Mail page's mode switcher (inbox / message log / mailboxes)
         was deleted with the legacy composer: the inbox IS the mailbox now.
         Mailbox connection management moved to Comms → Setup.

         NO IN-PAGE TAB STRIP AND NO `pageShell.wide`. The strip was a THIRD bar of
         navigation on this one screen: the ribbon's row B, the Comms tab bar
         six inches above it, and then a copy of the Comms tab bar. TabbedHub's
         own header says the in-page strip exists as the fallback for when the
         ribbon is not carrying an area's sections — and `areas.ts` defines no
         sections for Comms at all, so here it was never a fallback for
         anything. It rendered the same six links the bar above it already had.

         No width cap either: the panes manage their own width now, and an
         `mx-auto max-w-*` box cannot be a link in a height chain. */
      <section className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <InboxPage />
      </section>
    ) : (
      <TeamChatPage />
    );
  return (
    <section
      className={cn(
        "animate-fade-in",
        isChat && "flex h-full min-h-0 flex-col",
        isMail && "lg:flex lg:h-full lg:min-h-0 lg:flex-col",
      )}
    >
      <nav
        className="mb-4 flex shrink-0 items-end gap-1 border-b border-border"
        aria-label="Comms sections"
      >
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                "-mb-px border-b-2 px-3 pb-2 pt-1 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      {page}
    </section>
  );
}
