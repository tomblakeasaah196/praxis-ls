/**
 * Team chat: the list of conversations and the one that is open.
 *
 * ── TWO PANES, AND WHAT LEFT (tenant clean-up, 17 Nov 2026) ─────────────────
 *
 * After the mail and Setup screens were cut down, the tenant asked for the
 * same here. Three answers shaped this file:
 *
 *   The info panel is gone. It was a third pane, open by default, that held
 *   the conversation's name, the partner's status, a member count and a second
 *   call button. The header already had the name, the status and the call
 *   button; a group now shows its member count there too.
 *
 *   The list is Search and New. The four filter pills (All, Unread, In-house,
 *   Groups) and the per-device Chat Appearance control are gone. Unread
 *   conversations already carry a count and an accent time, and the list is
 *   short enough to search.
 *
 *   New is one dialog. It used to ask "in-house, group or email", then open a
 *   second dialog that asked "direct or group" again. Now you pick people: one
 *   is a direct message, several is a group you name. Email is written from
 *   the Mailbox tab.
 *
 * Conversation rides in the URL (?channel=…).
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { ErrorState } from "@/components/ui/states";
import { useResource, errMsg } from "@/lib/use-resource";
import { useAuth } from "@/app/auth/auth-context";
import { cn } from "@/lib/cn";
import { INDEX_ROW_IDLE, INDEX_ROW_OPEN } from "@/components/ui/index-row";
import { PlusIcon, PhoneIcon } from "@/components/ui/icons";
import { ThreadCallStrip } from "./call/thread-call-strip";
import { useCallCapabilities } from "./call/call-capabilities";
import { Checkbox } from "@/components/ui/checkbox";
import { useBranding } from "@/app/branding/branding-context";
import * as api from "@/lib/smartcomm-api";
import { channelTitle } from "./channel-title";
import { getCommsSocket, useCommsChannel } from "@/lib/comms-socket";
import { useOnline, lastSeenText } from "./presence";
import { dial, useCall } from "./call/call-session";
import { PinnedCallSummary } from "./call/pinned-call-summary";
import { Composer } from "./chat/composer";
import { MessageBubble } from "./chat/message-bubble";
import { ForwardDialog } from "./chat/forward-dialog";

/* avatar colouring — a fixed per-person palette (pixie parity), not the brand accent */
const AVATAR_COLOURS = [
  "#C9A86C",
  "#7FB069",
  "#5B9BD5",
  "#C0626E",
  "#9B7EDE",
  "#4DB6AC",
  "#E2934D",
  "#D46BA3",
];
function avatarColour(name?: string | null) {
  if (!name) return AVATAR_COLOURS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}
function initials(name?: string | null) {
  if (!name) return "?";
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

const AVATAR_SIZES = {
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-[12px]",
  lg: "h-16 w-16 text-lg",
} as const;

/** Avatar — the user's uploaded profile photo (avatar_ref /media URL) when they
 *  have one, else the hashed-colour initials chip (pixie parity). */
function Avatar({
  name,
  src,
  size = "md",
}: {
  name?: string | null;
  src?: string | null;
  size?: keyof typeof AVATAR_SIZES;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name || "avatar"}
        className={cn("shrink-0 rounded-full object-cover", AVATAR_SIZES[size])}
      />
    );
  }
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-white",
        AVATAR_SIZES[size],
      )}
      style={{ backgroundColor: avatarColour(name) }}
    >
      {initials(name)}
    </span>
  );
}
function fmtRelative(iso?: string | null) {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  // en-GB, not the workstation locale — "11 Sep", never "Sep 11".
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Start a conversation: pick people.
 *
 * ONE person is a direct message and needs nothing else. SEVERAL is a group,
 * and a group needs a name, so the name field appears with the second tick.
 * There is no "direct or group?" question because the selection already
 * answers it, and no way to make a group of one by mistake.
 */
function NewChatModal({
  colleagues,
  onClose,
  onCreated,
}: {
  colleagues: api.Colleague[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [selected, setSelected] = React.useState<string[]>([]);
  const [find, setFind] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  const group = selected.length > 1;
  const shown = colleagues.filter((c) =>
    `${c.full_name || ""} ${c.email || ""}`.toLowerCase().includes(find.trim().toLowerCase()),
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = group
        ? { name: name.trim(), kind: "DEPARTMENT" as const, member_ids: selected }
        : {
            name:
              colleagues.find((c) => c.user_id === selected[0])?.full_name ||
              "Direct message",
            kind: "DIRECT" as const,
            member_ids: selected.slice(0, 1),
          };
      const ch = await api.createChannel(body);
      onCreated(ch.group_id);
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  const canSubmit = selected.length === 1 || (group && !!name.trim());
  return (
    <Modal open onClose={onClose} title={tr("New Conversation")}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={tr("People")}>
          <div className="space-y-2">
            {colleagues.length > 8 && (
              <Input
                value={find}
                onChange={(e) => setFind(e.target.value)}
                placeholder={tr("Search colleagues…")}
                aria-label={tr("Search colleagues")}
              />
            )}
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {shown.map((c) => (
                <div
                  key={c.user_id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                >
                  <Checkbox
                    checked={selected.includes(c.user_id)}
                    onCheckedChange={() => toggle(c.user_id)}
                    label={
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar name={c.full_name} src={c.avatar_ref} size="sm" />
                        <span className="min-w-0 truncate">{c.full_name || c.email}</span>
                      </span>
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </Field>
        {group && (
          <Field label={tr("Group Name")} required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ops: Douala corridor"
            />
          </Field>
        )}
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            {tr("Cancel")}
          </Button>
          <Button type="submit" loading={busy} disabled={!canSubmit || busy}>
            {group ? tr("Start group") : tr("Start chat")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3z" />
    </svg>
  );
}
function MuteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path d="M3 3l18 18M18 8a6 6 0 00-9-5M6 8v4l-2 3h11" />
    </svg>
  );
}

/**
 * What the channel row previews: the words when there are words, otherwise what
 * the message carries. A media-only message has `body = NULL`, so reading the
 * body alone left a voice note previewing as "No messages yet".
 */
function channelPreview(c: api.Channel): string {
  const lm = c.last_message;
  if (!lm) return "No messages yet";
  if (lm.body) return lm.body;
  if (lm.has_voice_note) return tr("Voice note");
  if (lm.has_erp) return tr("Shared a record");
  if (lm.first_media_kind === "IMAGE") {
    return (lm.attachment_count || 1) > 1 ? tr("Photos") : tr("Photo");
  }
  if (lm.first_media_kind === "VIDEO") return tr("Video");
  if ((lm.attachment_count || 0) > 0) return tr("Attachment");
  if (lm.media_vault_id) return tr("Attachment");
  return "No messages yet";
}

function ChannelRow({
  c,
  active,
  senderName,
  onClick,
}: {
  c: api.Channel;
  active: boolean;
  /** Display name of the last message's sender, "You" when it was the viewer. */
  senderName?: string | null;
  onClick: () => void;
}) {
  const unread = c.unread || 0;
  /* Who said it, on group channels: in a DIRECT conversation there are two
   * people and the avatar already says which half is which, but "Voice note"
   * under "Ops Task Force" is useless without a name on it. */
  const showSender = c.kind !== "DIRECT" && !!c.last_message && !!senderName;
  const isDirect = c.kind === "DIRECT" && !!c.partner_user_id;
  /* Presence (guide §4.11): the dot is the socket — live, not a guess. When
   * the partner is OFFLINE the row says when they were last here, day-first;
   * when they're ONLINE the row is a normal chat row (the green dot carries
   * the news). Hook is unconditional — the row is one component for both. */
  const partnerOnline = useOnline(isDirect ? c.partner_user_id : null);
  const offlineSince = isDirect && !partnerOnline ? lastSeenText(c.partner_last_seen_at) : "";
  const preview = showSender
    ? `${senderName}: ${channelPreview(c)}`
    : offlineSince || channelPreview(c);
  return (
    <button
      type="button"
      onClick={onClick}
      // The current item of a set, said to assistive technology as IndexRow says it.
      aria-current={active ? "true" : undefined}
      className={cn(
        "relative flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2.5 text-left transition-colors",
        // The open conversation is marked the way every other list in the
        // product marks its open row (IndexRow): the tinted ground and the
        // rail. It used `bg-primary/10 ring-primary/25`, and neither compiles:
        // `--primary` is a plain colour variable, which takes no opacity. So
        // the open row had NO ground, and its ring fell back to Tailwind's
        // default blue, on a white-label product. Seen 17 Nov 2026, when the
        // Client inbox beside it marked its open row and this one did not.
        "before:absolute before:inset-y-1 before:left-1 before:w-[3px] before:rounded-full before:transition-colors before:content-['']",
        active ? INDEX_ROW_OPEN : INDEX_ROW_IDLE,
      )}
    >
      <Avatar
        name={channelTitle(c)}
        src={c.kind === "DIRECT" ? c.partner_avatar_ref : null}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-1">
          <span
            className={cn(
              "flex items-center gap-1 truncate text-[12.5px]",
              unread > 0
                ? "font-semibold text-foreground"
                : "text-muted-foreground",
            )}
          >
            {isDirect && (
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  partnerOnline ? "bg-[rgb(var(--ok))]" : "bg-[rgb(var(--ink-3))]",
                )}
                aria-hidden
              />
            )}
            <span className="truncate">{channelTitle(c)}</span>
            {c.is_pinned && (
              <span className="shrink-0 text-primary-ink">
                <PinIcon />
              </span>
            )}
            {c.is_muted && (
              <span className="shrink-0 text-muted-foreground">
                <MuteIcon />
              </span>
            )}
          </span>
          <span
            className={cn(
              "shrink-0 text-[10px]",
              unread > 0
                ? "font-semibold text-primary-ink"
                : "text-muted-foreground",
            )}
          >
            {fmtRelative(c.last_message?.created_at)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-1">
          <span
            className={cn(
              "truncate text-[11.5px]",
              unread > 0 ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {preview}
          </span>
          {unread > 0 && (
            <span
              className={cn(
                "grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full px-1 text-[9px] font-bold",
                c.is_muted
                  ? "bg-[rgb(var(--ink-3)/0.4)] text-primary-foreground"
                  : "chat-unread-dot text-primary-foreground",
              )}
            >
              {unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/** The honest presence line (guide §4.11): a LIVE dot that is the socket —
 *  green only while a socket is connected — and, under it, when the socket
 *  is gone, the last beat in the house day-first form. A dot with no signal
 *  behind it is a lie, so the green is conditional on the socket, never on
 *  the timestamp. */
function PartnerPresence({
  userId,
  lastSeenAt,
}: {
  userId: string;
  lastSeenAt?: string | null;
}) {
  const online = useOnline(userId);
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          online ? "bg-[rgb(var(--ok))]" : "bg-[rgb(var(--ink-3))]",
        )}
        aria-hidden
      />
      <span aria-live="polite">
        {online ? tr("Online now") : lastSeenText(lastSeenAt)}
      </span>
    </span>
  );
}

export function TeamChatPage() {
  /* The thread's backdrop is the tenant's own hero image when their branding
     has one. A per-device wallpaper and accent used to override it from a Chat
     Appearance control; that control left with the clean-up, so the chat wears
     the tenant's brand and nothing else. */
  const { branding } = useBranding();
  const wallpaper = branding?.hero?.imageUrl || null;
  const { user } = useAuth();
  const meId =
    (user as { user_id?: string; id?: string } | null)?.user_id ||
    (user as { id?: string } | null)?.id ||
    "";
  const [params, setParams] = useSearchParams();
  const activeId = params.get("channel");
  const channels = useResource(() => api.listChannels(), []);
  const colleagues = useResource(() => api.listColleagues(), []);
  const [creating, setCreating] = React.useState(false);
  const [q, setQ] = React.useState("");

  const nameOf = React.useMemo(() => {
    const m: Record<string, string> = {};
    (colleagues.data || []).forEach((c) => {
      m[c.user_id] = c.full_name || c.email;
    });
    return m;
  }, [colleagues.data]);

  const all = channels.data || [];
  const unreadTotal = all.reduce((s, c) => s + (c.unread || 0), 0);

  /* ── LIVE UNREAD, AT THE LIST LEVEL ───────────────────────────────────────
   *
   * The server publishes `comms:message` to the channel's room only, and the
   * open thread is the sole joiner — so without this, a message arriving in
   * any channel the reader is NOT viewing never moves this list's badges, and
   * the Ops Task Force counter sits stale until something is sent from here.
   * Join every member channel (membership-checked server-side, idempotent with
   * the thread's own join) and reload the list on arrival. The 15s interval is
   * the reconciler for a socket that was down when the message landed — the
   * same live-plus-poll bargain the thread itself already makes.
   *
   * Keyed on the joined id string, not the array: a reload returns a fresh
   * array with the same membership, and re-joining every room on each of those
   * would churn the socket for nothing. */
  const reloadRef = React.useRef(() => {});
  reloadRef.current = () => channels.reload();
  const channelKey = all.map((c) => c.group_id).join(",");
  React.useEffect(() => {
    const ids = channelKey ? channelKey.split(",") : [];
    if (!ids.length) return;
    const s = getCommsSocket();
    const onMessage = () => reloadRef.current();
    const join = () => {
      for (const id of ids) s.emit("channel:join", id);
    };
    s.on("comms:message", onMessage);
    if (s.connected) join();
    s.on("connect", join);
    return () => {
      s.off("comms:message", onMessage);
      s.off("connect", join);
      for (const id of ids) s.emit("channel:leave", id);
    };
  }, [channelKey]);
  React.useEffect(() => {
    const t = window.setInterval(() => reloadRef.current(), 15000);
    return () => window.clearInterval(t);
  }, []);
  const filtered = all.filter((c) => {
    if (q.trim()) {
      const hay = `${channelTitle(c)} ${channelPreview(c)}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  const select = (id: string) => {
    const n = new URLSearchParams(params);
    n.set("channel", id);
    setParams(n);
  };

  return (
    <section className="animate-fade-in flex min-h-0 flex-1 flex-col">
      {/* Size from the shell's remaining space, never from a guessed viewport offset. */}
      <div className="chat-shell grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] grid-cols-1 overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-[320px_minmax(0,1fr)]">
        {/* conversation list */}
        <div
          className={cn(
            "flex min-h-0 flex-col overflow-hidden border-border md:border-r",
            activeId ? "hidden md:flex" : "flex",
          )}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-[15px] font-medium">{tr("Chats")}</h2>
              {unreadTotal > 0 && (
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {unreadTotal > 99 ? "99+" : unreadTotal}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {/* A sleek accent-gradient pill in place of the solid orange block —
                  icon-only on a phone, icon + label from md up (WS feedback that a
                  bare "+" read as a generic "add"). */}
              <button
                type="button"
                onClick={() => setCreating(true)}
                title={tr("New Conversation")}
                aria-label={tr("New conversation")}
                className="chat-new-btn inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:px-3.5"
              >
                <PlusIcon width={16} height={16} />
                <span className="hidden md:inline">{tr("New")}</span>
              </button>
            </div>
          </div>
          <div className="px-3 py-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tr("Search conversations…")}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
            {channels.loading ? (
              <div className="space-y-1 p-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-14 animate-pulse rounded-xl border border-border bg-accent/40"
                  />
                ))}
              </div>
            ) : channels.error ? (
              <div className="p-4">
                <ErrorState message={channels.error} />
              </div>
            ) : filtered.length ? (
              <div className="space-y-px">
                {filtered.map((c) => {
                  const senderId = c.last_message?.sender_user_id || null;
                  const isMine = !!meId && !!senderId && senderId === meId;
                  return (
                    <ChannelRow
                      key={c.group_id}
                      c={c}
                      active={activeId === c.group_id}
                      senderName={
                        isMine ? tr("You") : senderId ? nameOf[senderId] || null : null
                      }
                      onClick={() => select(c.group_id)}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="space-y-2 px-4 py-12 text-center micro">
                <p>
                  {q ? tr("No conversations match.") : tr("No conversations yet")}
                </p>
                {/* The question this answers is "where is my email?", and it is
                    asked here because the header says Inbox. One sentence and a
                    link beats the chip that used to sit above and go nowhere. */}
                {!q && (
                  <p>
                    {tr("This is in-house chat.")}{" "}
                    <Link to="/comms/mail" className="font-medium text-foreground underline underline-offset-2">
                      {tr("Your email is in Mailbox.")}
                    </Link>
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* thread */}
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-col overflow-hidden",
            activeId ? "flex" : "hidden md:flex",
          )}
        >
          {activeId ? (
            <Thread
              key={activeId}
              channelId={activeId}
              meId={meId}
              nameOf={nameOf}
              channels={all}
              onBack={() => {
                const n = new URLSearchParams(params);
                n.delete("channel");
                setParams(n);
              }}
              onSent={() => channels.reload()}
              wallpaper={wallpaper}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center micro">
              {tr("Pick a conversation to start.")}
            </div>
          )}
        </div>

      </div>

      {creating && (
        <NewChatModal
          colleagues={colleagues.data || []}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            channels.reload();
            select(id);
          }}
        />
      )}
    </section>
  );
}

function Thread({
  channelId,
  meId,
  nameOf,
  channels,
  onBack,
  onSent,
  wallpaper,
}: {
  channelId: string;
  meId: string;
  nameOf: Record<string, string>;
  /** Every channel the viewer is in — the forward picker's options. */
  channels: api.Channel[];
  onBack: () => void;
  onSent: () => void;
  /** The tenant's hero image, when their branding has one. */
  wallpaper?: string | null;
}) {
  const detail = useResource(() => api.getChannel(channelId), [channelId]);
  /* WHO THIS IS, FROM THE LIST FIRST.
   *
   * The header used to wait on `getChannel` for the name, the status and the
   * call button, while the list one pane to the left already held the same
   * record. For as long as that second request was in flight, or if it failed,
   * the header read "Conversation" with no way to call. Nobody noticed, because
   * the info panel drew its own call button from the list's copy; when the
   * panel was removed (17 Nov 2026) the browser suite could no longer dial.
   *
   * So the header is drawn from the list's record at once, and the detail
   * replaces it when it lands. A detail without a `kind` is not a detail. */
  const fromList = React.useMemo(
    () => channels.find((c) => c.group_id === channelId) || null,
    [channels, channelId],
  );
  const ch = { data: detail.data && detail.data.kind ? detail.data : fromList };
  const thread = useResource(() => api.getThread(channelId), [channelId]);
  // The phone icon only where calls are on and this person may dial (F10).
  const canDial = useCallCapabilities()?.can_dial === true;
  // The caller's call-summary drafts for this conversation, pinned above the
  // composer (owner decision O3). `?summary=<call>` opens one: that is where
  // the summary notification lands.
  const [params, setParams] = useSearchParams();
  const openSummary = params.get("summary");
  const setOpenSummary = React.useCallback((callId: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (callId) next.set("summary", callId);
      else next.delete("summary");
      return next;
    }, { replace: true });
  }, [setParams]);
  const { summaryTick } = useCall();
  const reloadThread = thread.reload;
  React.useEffect(() => {
    if (summaryTick) reloadThread();
  }, [summaryTick, reloadThread]);
  const followedInitially = React.useRef(false);
  const nearBottom = React.useRef(true);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  // Memoised because `thread.data?.messages || []` is a fresh array on every
  // render, which would make the reply-quote map below rebuild each time.
  const msgs = React.useMemo(() => thread.data?.messages || [], [thread.data]);
  /** One card per distinct URL in this page, from the tenant's own preview cache. */
  const linkPreviews = React.useMemo(
    () => thread.data?.links || undefined,
    [thread.data],
  );

  /**
   * Which message's action rail a touch device is currently showing.
   *
   * State lives HERE rather than in each bubble, and that placement is the whole
   * design: one open rail at a time is what makes "tap the message" unambiguous.
   * Tapping a second message closes the first, so a thread cannot accumulate
   * fifteen emoji strips, and the reader always knows which message the bar
   * belongs to. An Escape key and a tap outside clear it, because a control that
   * can only be dismissed by finding the right message to tap again is a modal
   * that forgot to trap anything.
   */
  const [revealedId, setRevealedId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!revealedId) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRevealedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [revealedId]);
  // Changing channel while a rail is open must not leave the id pointing at a
  // message in the channel that is no longer on screen.
  React.useEffect(() => setRevealedId(null), [channelId]);

  const composerBusy = React.useRef(false);
  const [editingMessage, setEditingMessage] = React.useState<api.CommMessage | null>(null);
  const [replyTo, setReplyTo] = React.useState<api.CommMessage | null>(null);
  const [forwarding, setForwarding] = React.useState<api.CommMessage | null>(null);

  // Live updates (socket.io). Any channel event refreshes the thread; a peer's
  // typing shows a transient indicator. The 8s poll below stays as a fallback
  // for when the socket can't connect.
  const [typingName, setTypingName] = React.useState<string | null>(null);
  const typingTimer = React.useRef<number | null>(null);
  const { setTyping } = useCommsChannel(channelId, {
    "comms:message": () => {
      thread.reload();
      onSent();
    },
    "comms:message_edited": () => thread.reload(),
    "comms:message_deleted": () => thread.reload(),
    "comms:reaction": () => thread.reload(),
    // A voice note's transcript lands after the message it belongs to — the
    // clip is posted immediately and transcribed afterwards, deliberately.
    // This is what makes the words appear under a bubble somebody is already
    // looking at rather than on their next reload.
    "comms:transcript": () => thread.reload(),
    "channel:typing": (p: { user_id?: string }) => {
      if (!p?.user_id || p.user_id === meId) return;
      setTypingName(nameOf[p.user_id] || "Someone");
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(() => setTypingName(null), 3000);
    },
  });

  /* Through a ref, not the prop: `onSent` is an inline arrow in the parent, so
   * depending on it would re-mark-read on every parent render, and the reload
   * it triggers IS a parent render. */
  const onSentRef = React.useRef(onSent);
  onSentRef.current = onSent;
  React.useEffect(() => {
    api
      .markRead(channelId)
      /* …and then say so upstairs. Marking read without reloading the list
         left the channel's own badge standing after the messages had been
         read — the second half of the stale-counter complaint. */
      .then(() => onSentRef.current())
      .catch(() => {
        /* @silent:storage — an unsent read marker costs a stale unread badge until
           the next open, never a message */
      });
  }, [channelId, msgs.length]);

  /**
   * Follow the conversation, but only when the reader is already at the bottom.
   *
   * Scrolling unconditionally is the defect every chat has had at least once:
   * somebody reading back through yesterday gets yanked to the end each time a
   * colleague types, and there is no way to finish reading a paragraph.
   */
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (!msgs.length) return;
    // Only move this pane. scrollIntoView also moves the shell/ancestors.
    if (!followedInitially.current || nearBottom.current) {
      el.scrollTop = el.scrollHeight;
      followedInitially.current = true;
    }
  }, [msgs.length]);

  React.useEffect(() => {
    const t = window.setInterval(() => thread.reload(), 8000);
    return () => window.clearInterval(t);
  }, [thread]);

  // Reply quotes resolve against the page the reader has. A reply to something
  // older than the loaded window renders without its quote rather than
  // fetching one message at a time while scrolling.
  const byId = React.useMemo(
    () => new Map(msgs.map((m) => [m.message_id, m])),
    [msgs],
  );

  return (
    <>
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border bg-card/70 px-3 py-2.5 backdrop-blur-sm">
        <button
          className="text-muted-foreground hover:text-foreground md:hidden"
          onClick={onBack}
          aria-label={tr("Back")}
        >
          ←
        </button>
        <Avatar
          name={channelTitle(ch.data)}
          src={ch.data?.kind === "DIRECT" ? ch.data?.partner_avatar_ref : null}
          size="sm"
        />
        {/* Name, and — for a DIRECT thread — a WhatsApp-style presence line under
            it. The "· direct" kind label is gone: product jargon has no place in
            the one line a person reads to know whom they are talking to. */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {channelTitle(ch.data) || "Conversation"}
          </div>
          {ch.data?.kind === "DIRECT" && ch.data.partner_user_id && (
            <PartnerPresence
              userId={ch.data.partner_user_id}
              lastSeenAt={ch.data.partner_last_seen_at}
            />
          )}
          {/* A group says how many people are in it. This is the one fact the
              info panel held that the header did not. */}
          {ch.data && ch.data.kind !== "DIRECT" && ch.data.member_count != null && (
            <span className="text-[11px] text-muted-foreground">
              {ch.data.member_count} {ch.data.member_count === 1 ? tr("member") : tr("members")}
            </span>
          )}
        </div>
        {/* THE call button: one, here. It was also an item in a ⋮ menu beside
            it and a pill in the info panel, three ways to do one thing on one
            screen. The partner is resolved server-side
            from the channel; the UI only names the channel (guide D8). */}
        {ch.data?.kind === "DIRECT" && canDial && (
          <button
            type="button"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={tr("Start a voice call")}
            title={tr("Start a voice call")}
            onClick={() => {
              if (ch.data) void dial(ch.data.group_id, channelTitle(ch.data));
            }}
          >
            <PhoneIcon width={18} height={18} />
          </button>
        )}
      </div>

      {/* The call of this conversation: the ring banner, then the live strip (O4). */}
      <ThreadCallStrip groupId={channelId} />

      <div
        ref={scrollerRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
        }}
        className={cn(
          "chat-thread-bg min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6",
          wallpaper && "chat-thread-bg--photo",
        )}
        style={
          wallpaper
            ? ({ "--chat-thread-image": `url("${wallpaper}")` } as React.CSSProperties)
            : undefined
        }
        // A tap on the empty scroller — beside a bubble, in the gap between two —
        // is the reader saying "not this one". The bubbles themselves stop nothing,
        // so this only fires for the background.
        onPointerDown={(event) => {
          if (!revealedId) return;
          // Bubbles handle their own taps (see `message-bubble.tsx`), and the
          // pointer event from one of those arrives here too, because events
          // bubble. Without this guard the ancestor would clear what the child
          // just set, in the same tick, and the rail would never appear at all —
          // the single most likely way to get this interaction wrong.
          const target = event.target as HTMLElement | null;
          if (target?.closest?.("[data-message-bubble]")) return;
          setRevealedId(null);
        }}
      >
        {thread.loading && msgs.length === 0 ? (
          <div className="micro">{tr("Loading…")}</div>
        ) : thread.error ? (
          <ErrorState message={thread.error} />
        ) : msgs.length ? (
          msgs.map((m) => (
            <MessageBubble
              key={m.message_id}
              message={m}
              mine={!!meId && m.sender_user_id === meId}
              meId={meId}
              senderName={m.sender_user_id ? nameOf[m.sender_user_id] || tr("Someone") : null}
              repliedTo={m.reply_to_message_id ? byId.get(m.reply_to_message_id) || null : null}
              onEdit={(message) => { if (!composerBusy.current) setEditingMessage(message); }}
              onReply={(message) => { if (!composerBusy.current) setReplyTo(message); }}
              onForward={setForwarding}
              onChanged={() => { thread.reload(); onSent(); }}
              links={linkPreviews}
              revealed={revealedId === m.message_id}
              onToggleReveal={() =>
                setRevealedId((current) => (current === m.message_id ? null : m.message_id))
              }
              onReacted={() => setRevealedId(null)}
            />
          ))
        ) : (
          <div className="flex h-full items-center justify-center micro">
            {tr("No messages yet: say hello.")}
          </div>
        )}
      </div>

      {typingName && (
        <div className="px-4 pb-1 text-[11px] italic text-muted-foreground">
          {typingName} {tr("is typing…")}
        </div>
      )}

      <PinnedCallSummary
        drafts={thread.data?.pending_call_summaries || []}
        openCallId={openSummary}
        onOpenChange={setOpenSummary}
        onChanged={() => {
          setOpenSummary(null);
          thread.reload();
          onSent();
        }}
        refreshKey={summaryTick}
      />

      <Composer
        channelId={channelId}
        editingMessage={editingMessage}
        onBusyChange={(busy) => { composerBusy.current = busy; }}
        onCancelEdit={() => setEditingMessage(null)}
        onEditLast={() => {
          const last = [...msgs].reverse().find((m) => m.sender_user_id === meId && !!m.body && !m.deleted_at);
          if (last) setEditingMessage(last);
        }}
        replyTo={
          replyTo
            ? {
              message_id: replyTo.message_id,
              body: replyTo.body,
              sender: replyTo.sender_user_id ? nameOf[replyTo.sender_user_id] : null,
            }
            : null
        }
        onCancelReply={() => setReplyTo(null)}
        onTyping={setTyping}
        onSent={() => { thread.reload(); onSent(); }}
      />

      <ForwardDialog
        message={forwarding}
        channels={channels}
        currentChannelId={channelId}
        onClose={() => setForwarding(null)}
        onForwarded={onSent}
      />
    </>
  );
}
