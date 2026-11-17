/**
 * Client inbox — every client's portal conversations in one place (client
 * portal PR 3). Comms › Clients.
 *
 * ── IT IS THE CHAT SCREEN, FOR CLIENTS (tenant review, 17 Nov 2026) ─────────
 *
 * The tenant said this screen looked different from the rest of the product and
 * merely repeated a client's own Messages tab. It was a list of conversations
 * beside a card of account manager details over a card of messages. It is now
 * laid out as Comms › Chat is, one tab to the left:
 *
 *   The list is ONE ROW PER CLIENT, not one per conversation: the avatar, the
 *   name, the latest message across all the client's conversations with who
 *   wrote it, when, and how many are unread in total. A client with General and
 *   three shipments was four rows saying the same name.
 *
 *   The conversation is Chat's: the same bubbles, the same message box, the
 *   full height of the screen. General and each shipment are tabs at its top.
 *
 *   The account manager, "Also Notify" and "Told about this client" left the
 *   space above the messages for a panel behind the info button in the header,
 *   closed until somebody asks. It stays as it was left while they move from
 *   client to client, so assigning six account managers is not six openings.
 *
 * ── ONE READ, THREE FILTERS ─────────────────────────────────────────────────
 *
 * Waiting, Mine and All each used to ask the server again, and the server
 * answered with the conversations that matched. That cannot draw one row per
 * client: under Waiting the row would show only the client's waiting
 * conversations, so the same client would carry a different last message and a
 * different time under All. The server reads the same rows whichever filter is
 * asked for, so this asks once, for all of them, and filters here. A row then
 * says the same thing under every filter, and each filter's count is the number
 * of CLIENTS it lists, which is what the rows under it add up to.
 *
 * ── THE OPEN CONVERSATION RIDES IN THE URL ──────────────────────────────────
 *
 * `?client=<id>&thread=<general|dossier id>`, as Chat's rides in `?channel=`.
 * It is the address the team's alert for a new client message points at, and it
 * now stays in the address bar instead of being cleared once read: a reload
 * keeps the conversation open, and on a phone, where the conversation covers
 * the list, Back returns to the list rather than leaving Comms.
 *
 * Gated on MOD-64C (the Client inbox permission, seeds 90997/9136): the
 * people who answer clients.
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { tr } from "@/lib/i18n";
import { tenant } from "@/lib/api-client";
import { useResource } from "@/lib/use-resource";
import { useIsDesktop } from "@/lib/use-media-query";
import { cn } from "@/lib/cn";
import { Chips } from "@/components/ui/chips";
import { IndexRow } from "@/components/ui/index-row";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { ClientChatPanel } from "@/features/portal/client-chat-panel";
import { ChatAvatar } from "./client-inbox-avatar";
import { groupByClient, lastLine, shortAgo, type ClientRow, type InboxItem } from "./client-inbox-rows";

type Filter = "waiting" | "mine" | "all";

/** `truncated`: the server read its limit, so the list and counts stop there. */
type Inbox = { filter: Filter; counts: Record<Filter, number>; items: InboxItem[]; truncated?: boolean };

/** Refreshed this often while the tab is visible: a client's question is not an email. */
const POLL_MS = 30_000;

const FILTERS: Filter[] = ["waiting", "mine", "all"];
const KEEP: Record<Filter, (row: ClientRow) => boolean> = {
  waiting: (row) => row.unread > 0,
  mine: (row) => row.mine,
  all: () => true,
};

export function ClientInboxPage() {
  // The info panel sits beside the messages where there is room for a third
  // column, and opens as a sheet over them everywhere else.
  const isDesktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const openClient = params.get("client");
  const openThread = params.get("thread") || "general";
  // A link to one conversation shows every client, so its row is in the list.
  const [filter, setFilter] = React.useState<Filter>(() => (params.get("client") ? "all" : "waiting"));
  const [infoOpen, setInfoOpen] = React.useState(false);
  const inbox = useResource(() => tenant<Inbox>("/portal/chat/inbox?filter=all"), [], { fresh: true });

  /*
   * A conversation opened by anything but a press on a row here — an alert's
   * link while this screen is already up — shows All, for the same reason the
   * first render does. A row pressed under Waiting must NOT: answering it takes
   * the client off that list, and a filter that changed by itself at that
   * moment would read as the screen losing its place.
   */
  const pressed = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!openClient || pressed.current.has(openClient)) return;
    pressed.current.add(openClient);
    setFilter("all");
  }, [openClient]);

  const reload = inbox.reload;
  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [reload]);

  const rows = React.useMemo(() => groupByClient(inbox.data?.items || []), [inbox.data]);
  const shown = rows.filter(KEEP[filter]);
  const open = openClient ? rows.find((row) => row.client_id === openClient) || null : null;
  const unreadTotal = rows.reduce((sum, row) => sum + row.unread, 0);

  const options = FILTERS.map((f) => ({
    value: f,
    label: f === "waiting" ? tr("Waiting") : f === "mine" ? tr("Mine") : tr("All"),
    // Only once the rows are in: a zero before then would be a guess.
    count: inbox.data ? rows.filter(KEEP[f]).length || undefined : undefined,
  }));

  function openRow(row: ClientRow) {
    pressed.current.add(row.client_id);
    const next = new URLSearchParams(params);
    next.set("client", row.client_id);
    next.set("thread", row.opens);
    setParams(next);
  }

  return (
    <section className="animate-fade-in flex min-h-0 flex-1 flex-col">
      {/* Sized from the shell's remaining space, as Chat is: the list and the
          messages each scroll inside it and the page itself does not. */}
      <div className="chat-shell grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-[320px_minmax(0,1fr)]">
        {/* On a phone the list is the screen, and an open conversation takes
            its place until Back. */}
        <div className={cn("min-h-0 flex-col overflow-hidden border-border md:border-r", openClient ? "hidden md:flex" : "flex")}>
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
            <h2 className="font-display text-[15px] font-medium">{tr("Clients")}</h2>
            {unreadTotal > 0 ? (
              <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {unreadTotal > 99 ? "99+" : unreadTotal}
              </span>
            ) : null}
          </div>
          <div className="shrink-0 px-3 py-2">
            <Chips label={tr("Show")} value={filter} options={options} onChange={(v) => setFilter(v as Filter)} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
            {inbox.error ? (
              <div className="p-2">
                <ErrorState message={inbox.error} />
              </div>
            ) : inbox.loading && !inbox.data ? (
              <div role="status" aria-label={tr("Loading conversations…")} className="space-y-1 p-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-14 animate-pulse rounded-xl border border-border bg-accent" />
                ))}
              </div>
            ) : !shown.length ? (
              <EmptyState
                className="m-2"
                title={filter === "waiting" ? tr("Nothing waiting: every client has an answer") : tr("No conversations")}
                hint={filter === "mine" ? tr("Your clients are the ones you look after, and the files you own.") : undefined}
              />
            ) : (
              <div className="space-y-px">
                {shown.map((row) => (
                  <IndexRow
                    key={row.client_id}
                    selected={row.client_id === openClient}
                    onClick={() => openRow(row)}
                    className="items-center gap-2.5 rounded-2xl py-2.5"
                  >
                    <ChatAvatar name={row.client_name} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-1">
                        <span className="truncate text-[12.5px] font-semibold text-foreground">{row.client_name}</span>
                        <span className={cn("shrink-0 text-[10px]", row.unread > 0 ? "font-semibold text-primary-ink" : "text-muted-foreground")}>
                          {shortAgo(row.last.at)}
                        </span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-1">
                        <span className={cn("truncate text-[11.5px] font-normal", row.unread > 0 ? "text-foreground" : "text-muted-foreground")}>
                          {lastLine(row)}
                        </span>
                        {row.unread > 0 ? (
                          <span className="chat-unread-dot grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full px-1 text-[9px] font-bold text-primary-foreground">
                            {row.unread}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </IndexRow>
                ))}
              </div>
            )}
            {inbox.data?.truncated ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                {tr("Showing the most recent conversations. Older ones are on each client's Messages tab.")}
              </p>
            ) : null}
          </div>
        </div>

        <div className={cn("min-h-0 min-w-0 flex-col overflow-hidden", openClient ? "flex" : "hidden md:flex")}>
          {openClient ? (
            <ClientChatPanel
              // One conversation box per client: a reply half typed to one
              // client must not be waiting in the box when another is opened.
              key={openClient}
              clientId={openClient}
              thread={openThread}
              onThreadChange={(thread) => {
                const next = new URLSearchParams(params);
                next.set("thread", thread);
                // Replaced, not pushed: Back from a conversation is the list,
                // not a walk back through every tab that was looked at.
                setParams(next, { replace: true });
              }}
              onActivity={reload}
              fill
              infoBeside={isDesktop}
              infoOpen={infoOpen}
              onInfoOpenChange={setInfoOpen}
              header={
                <>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
                    aria-label={tr("Back")}
                    onClick={() => {
                      const next = new URLSearchParams(params);
                      next.delete("client");
                      next.delete("thread");
                      setParams(next);
                    }}
                  >
                    ←
                  </button>
                  <ChatAvatar name={open?.client_name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold">{open ? open.client_name : tr("Conversation")}</h2>
                    {/* Who looks after this client, where Chat says who is
                        online: the one fact about them worth a glance without
                        opening the panel. */}
                    {open ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {open.manager ? open.manager.name || tr("Account manager") : tr("No account manager")}
                      </span>
                    ) : null}
                  </div>
                </>
              }
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center micro">{tr("Pick a conversation to start.")}</div>
          )}
        </div>
      </div>
    </section>
  );
}
