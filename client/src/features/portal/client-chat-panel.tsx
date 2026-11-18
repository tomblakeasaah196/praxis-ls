/**
 * The team's side of a client's portal chat (14170): General and one
 * conversation per shipment, with the photos, PDFs, voice notes and locations
 * the client sends, and a reply box that can carry a file back.
 *
 * ── IT LOOKS LIKE CHAT, BECAUSE IT IS ONE (tenant review, 17 Nov 2026) ──────
 *
 * The tenant's words were that Comms › Clients "looks different from the rest
 * of the product". It did: a card of grey bubbles under a card of account
 * manager details, where Comms › Chat one tab to the left is a conversation.
 * So this panel now wears Chat's own classes: the tinted `.msg-bubble`s on the
 * `.chat-thread-bg` backdrop (the tenant's hero image when their branding has
 * one), and Chat's rounded message box with the `+` and the microphone.
 *
 * Team chat and client chat are different backends (`/smartcomm` and
 * `/portal/chat`), so nothing of Chat's thread is mounted here. The look is
 * shared; the features are the client's own and unchanged: text, photos,
 * documents, voice notes, a location, the quotation a message is about, and
 * "Send by email" on a team message.
 *
 * ── WHAT MOVED ──────────────────────────────────────────────────────────────
 *
 *   The conversations are TABS at the top (General, then one per shipment),
 *   each with its unread count. They were a row of filter chips.
 *
 *   The account manager, "Also Notify" and "Told about this client" sat ABOVE
 *   the messages, on every visit, and took the height the messages needed. They
 *   are behind an info button now, closed until asked for: a panel beside the
 *   messages where there is room, a sheet over them where there is not.
 *
 * Opening a conversation marks the client's messages in it read, which is the
 * "seen" tick on their phone; answering does the same. The same panel serves
 * the Client inbox (Comms › Clients, which adds the list of clients and a
 * header naming the open one) and a client's own Messages tab.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { tr, tv } from "@/lib/i18n";
import { tenant, tenantObjectUrl, tenantDownload, uploadFile } from "@/lib/api-client";
import { errMsg } from "@/lib/use-resource";
import { useUpload } from "@/lib/use-upload";
import { useFabFloor } from "@/lib/fab-floor";
import { dateTimeFmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useBranding } from "@/app/branding/branding-context";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { InfoIcon, MailIcon } from "@/components/ui/icons";
import { MoreMenu } from "@/components/ui/more-menu";
import { DropdownItem } from "@/components/ui/dropdown-menu";
import { TabList, TabsContent, TabsRoot, type TabItem } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/ui/pill";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { FilePicker, UploadList } from "@/components/ui/image-upload";
import { pasteFileFromEvent } from "@/components/ui/upload-paste";
import { useToast } from "@/components/ui/toast";
import { useCanUseModule } from "@/lib/route-access";
import { useRefreshEvent } from "@/lib/open-in-app";
import { quotationHref } from "@/lib/quotation-api";
import { VoiceRecorder, type Recording } from "@/features/comms/chat/voice-recorder";
import { ClientChatTools, ShareLocationDialog, type SharedPlace } from "./client-chat-tools";
import { FileOnQuoteRequestDialog, type ChatFile } from "@/features/sales/file-on-quote-request";
import { DeliveryLine, SendByEmailDialog, type DeliveryPerson } from "./client-message-email";
import { AccountManagerCard } from "./account-manager";

type Attachment = {
  attachment_id: string;
  kind: "IMAGE" | "FILE" | "VOICE";
  name: string | null;
  mime_type: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
};
export type Message = {
  message_id: string;
  direction: "STAFF" | "CLIENT";
  body: string;
  created_at: string;
  author: { name: string | null; email: string | null; portal_user_id?: string | null };
  seen: boolean | null;
  milestone: { milestone_instance_id: string; label: string | null } | null;
  /** "Ask about this quotation" (meeting 6, G3): the offer the client asked about. */
  reference?: Reference | null;
  location: { lat: number; lng: number; label: string | null } | null;
  attachments: Attachment[];
  /** On a TEAM message: what its email did for each person at the client (D8). */
  delivery?: DeliveryPerson[];
};
type Reference = { kind: "quotation" | "proposal"; id: string; label: string | null };
type Page = { thread: string; dossier_ref: string | null; has_more: boolean; messages: Message[] };
type Thread = { dossier_id: string | null; dossier_ref: string | null; last_at: string; unread: number };

const POLL_MS = 15_000;

/** The round icon button Chat's header and message rail use. */
const ROUND_BUTTON =
  "grid shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
/** The small raised button that hangs off a message, as on a Chat bubble. */
const RAIL_BUTTON =
  "h-7 w-7 place-items-center rounded-full border border-border bg-popover text-muted-foreground shadow-[var(--shadow-m)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * What the client's message is about — the offer they pressed "Ask about this
 * quotation" on (meeting 6, G3) — as a chip that opens it.
 */
function ReferenceChip({ r }: { r: Reference }) {
  // A proposal from before the merge opens the quotation it became (/sales/proposals/:id resolves it).
  const href = r.kind === "quotation" ? quotationHref(r.id) : `/sales/proposals/${encodeURIComponent(r.id)}`;
  const label = r.label || (r.kind === "quotation" ? tr("Quotation") : tr("Proposal"));
  return (
    <p className="mb-1">
      <Link
        to={href}
        className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-primary-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={r.kind === "quotation" ? tv("About quotation {{ref}} — open it", { ref: label }) : tv("About proposal {{ref}} — open it", { ref: label })}
      >
        <span className="truncate">{r.kind === "quotation" ? tv("About quotation {{ref}}", { ref: label }) : tv("About proposal {{ref}}", { ref: label })}</span>
      </Link>
    </p>
  );
}
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";

/** A photo from the chat — fetched with the session, since an <img> cannot send it. */
function ChatPhoto({ att }: { att: Attachment }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    const ctl = new AbortController();
    let made: string | null = null;
    tenantObjectUrl(`/portal/chat/attachments/${att.attachment_id}?size=preview`, ctl.signal)
      .then((u) => {
        made = u;
        setUrl(u);
      })
      .catch(() => {
        if (!ctl.signal.aborted) setFailed(true);
      });
    return () => {
      ctl.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [att.attachment_id]);
  const ratio = att.width && att.height ? Math.min(Math.max(att.width / att.height, 0.66), 1.8) : 4 / 3;
  return (
    <button
      type="button"
      className="block w-64 max-w-full overflow-hidden rounded-lg border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ aspectRatio: String(ratio) }}
      title={tr("Download the Original")}
      onClick={() => void tenantDownload(`/portal/chat/attachments/${att.attachment_id}`, att.name || "photo.jpg")}
    >
      {url ? (
        <img src={url} alt={att.name || ""} className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center text-xs text-muted-foreground">
          {failed ? tr("Photo unavailable") : "…"}
        </span>
      )}
    </button>
  );
}

/** A voice note: fetched when first played, not when the conversation opens. */
function ChatVoice({ att }: { att: Attachment }) {
  const toast = useToast();
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  if (url) return <audio controls autoPlay src={url} className="h-10 w-64 max-w-full" />;
  const secs = Math.round((att.duration_ms || 0) / 1000);
  return (
    <button
      type="button"
      className="voice-wave flex max-w-full items-center gap-2.5 py-1.5 pl-1.5 pr-3.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() =>
        tenantObjectUrl(`/portal/chat/attachments/${att.attachment_id}`)
          .then(setUrl)
          .catch((e) => toast.error(errMsg(e)))
      }
    >
      <span aria-hidden className="voice-wave-play grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs">
        ▶
      </span>
      <span>{`${tr("Voice note")}${secs ? ` · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : ""}`}</span>
    </button>
  );
}

/** "240 KB", "1.2 MB", or nothing when the size is not known. */
function humanSize(bytes?: number | null): string {
  const n = Number(bytes) || 0;
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A document in a bubble: the row Chat draws, downloaded on a press. */
function ChatDocument({ att }: { att: Attachment }) {
  const name = att.name || tr("Document");
  const size = humanSize(att.size);
  return (
    <button
      type="button"
      // The name alone: the size is a detail of the row, not of what it does.
      aria-label={name}
      className="flex w-full max-w-[320px] items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => void tenantDownload(`/portal/chat/attachments/${att.attachment_id}`, att.name || "document.pdf")}
    >
      <span aria-hidden className="text-xl leading-none">
        {String(att.mime_type || "").includes("pdf") ? "📕" : "📄"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{name}</span>
        {size ? <span className="block text-micro text-muted-foreground">{size}</span> : null}
      </span>
      <span aria-hidden className="text-muted-foreground">
        ↓
      </span>
    </button>
  );
}

/** "File on a quote request" under a client's photo or PDF (meeting 6, PR 2). */
function FileOnRequestButton({ att, onFile }: { att: Attachment; onFile: (f: ChatFile) => void }) {
  return (
    <button
      type="button"
      className="mt-0.5 block text-[11px] font-medium text-primary-ink underline underline-offset-2 hover:opacity-80"
      onClick={() => onFile({ attachment_id: att.attachment_id, name: att.name, kind: att.kind })}
    >
      {tr("File on a quote request")}
    </button>
  );
}

/**
 * One message, in Chat's bubble: a tinted surface with one sharp corner on the
 * sender's side (`.msg-bubble` in index.css, so the tint follows the tenant's
 * accent). The team's messages sit on the right, the client's on the left.
 *
 * Both sides carry a name, where Chat names only the other person: "the team"
 * is several people answering one client, and who replied is the thing a
 * colleague reads the conversation to find out.
 */
export function Bubble({
  m,
  onEmail,
  onFile,
}: {
  m: Message;
  onEmail?: (m: Message) => void;
  onFile?: (f: ChatFile) => void;
}) {
  const ours = m.direction === "STAFF";
  // Which colleague at the client wrote it: their name, with the address under
  // it — two people at one client can share a first name.
  const who = ours ? m.author.name || tr("Team") : m.author.name || m.author.email || tr("Client");
  const whoEmail = !ours && m.author.name && m.author.email ? m.author.email : null;
  const emailable = ours && !!onEmail;
  return (
    <li data-message-bubble className={cn("group flex animate-rise-in items-start gap-1", ours ? "justify-end" : "justify-start")}>
      {emailable ? (
        <>
          {/* "Send by email" (D8): an envelope on hover where there is a
              pointer that hovers, the message's ⋯ menu on a touch screen. */}
          <button
            type="button"
            title={tr("Send by email")}
            aria-label={tr("Send by email")}
            onClick={() => onEmail?.(m)}
            className={cn(
              RAIL_BUTTON,
              "mt-1 hidden shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:grid",
            )}
          >
            <MailIcon width={14} height={14} />
          </button>
          <MoreMenu label={tr("Message actions")} className="mt-1 h-8 w-8 border-0 [@media(hover:hover)]:hidden">
            <DropdownItem onSelect={() => onEmail?.(m)}>{tr("Send by email")}</DropdownItem>
          </MoreMenu>
        </>
      ) : null}
      <div
        className={cn(
          "msg-bubble min-w-0 max-w-[78%] px-3.5 py-2.5 text-sm",
          // @dash:keep a CSS class name (the bubble's side, index.css), not copy
          ours ? "msg-bubble--mine" : "msg-bubble--theirs",
        )}
      >
        <p className="mb-0.5 text-[11px] font-semibold text-primary-ink">
          {who}
          {whoEmail ? <span className="ml-1.5 font-normal text-muted-foreground">{whoEmail}</span> : null}
        </p>
        {m.milestone?.label ? (
          <p className="mb-1">
            <Pill tone="blue">{m.milestone.label}</Pill>
          </p>
        ) : null}
        {m.reference ? <ReferenceChip r={m.reference} /> : null}
        {m.attachments.map((a) => (
          <div key={a.attachment_id} className="mb-1.5">
            {a.kind === "IMAGE" ? <ChatPhoto att={a} /> : a.kind === "VOICE" ? <ChatVoice att={a} /> : <ChatDocument att={a} />}
            {/* Only what the CLIENT sent — the team's own replies are not their
                documents — and never a voice note. */}
            {onFile && m.direction === "CLIENT" && a.kind !== "VOICE" ? <FileOnRequestButton att={a} onFile={onFile} /> : null}
          </div>
        ))}
        {m.location ? (
          <a
            className="mb-1 block text-primary-ink underline"
            href={`https://www.google.com/maps/search/?api=1&query=${m.location.lat},${m.location.lng}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {m.location.label || tr("Location")} ({m.location.lat.toFixed(5)}, {m.location.lng.toFixed(5)})
          </a>
        ) : null}
        {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
        {/* The day as well as the time: a client conversation runs over weeks,
            and there is no date line between its days. */}
        <p className="mt-1 text-right text-[10px] text-muted-foreground">{dateTimeFmt(m.created_at)}</p>
        {ours ? <DeliveryLine people={m.delivery} /> : null}
      </div>
    </li>
  );
}

export function ClientChatPanel({
  clientId,
  initialThread = "general",
  thread: threadProp,
  onThreadChange,
  onActivity,
  header,
  fill = false,
  infoBeside = false,
  infoOpen: infoOpenProp,
  onInfoOpenChange,
}: {
  clientId: string;
  initialThread?: string;
  /**
   * The open conversation, when the screen holds it (the Client inbox keeps it
   * in the URL, so a link opens the right tab). Leave both out and the panel
   * remembers its own.
   */
  thread?: string;
  onThreadChange?: (thread: string) => void;
  /**
   * Something changed here that the list beside it shows: a conversation was
   * read or answered, or the account manager was changed. The Client inbox
   * re-reads its rows.
   */
  onActivity?: () => void;
  /**
   * Who the conversation is with, drawn above the tabs. The Client inbox
   * passes the client's avatar and name; a client's own Messages tab passes
   * nothing, because the page it sits on is already that client.
   */
  header?: React.ReactNode;
  /** Take the height the parent gives (the Client inbox) instead of a block of its own. */
  fill?: boolean;
  /** Open the info panel beside the messages. Without it the panel is a sheet over them. */
  infoBeside?: boolean;
  /** Whether the info panel is open, when the screen keeps that across clients. */
  infoOpen?: boolean;
  onInfoOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  /* The backdrop is the tenant's own hero image when their branding has one,
     under the same wash Chat puts over it. */
  const { branding } = useBranding();
  const wallpaper = branding?.hero?.imageUrl || null;
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [ownThread, setOwnThread] = React.useState(initialThread);
  const thread = threadProp ?? ownThread;
  const setThread = (next: string) => {
    setOwnThread(next);
    onThreadChange?.(next);
  };
  const [ownInfoOpen, setOwnInfoOpen] = React.useState(false);
  const infoOpen = infoOpenProp ?? ownInfoOpen;
  const setInfoOpen = (next: boolean) => {
    setOwnInfoOpen(next);
    onInfoOpenChange?.(next);
  };
  const infoId = React.useId();
  const [page, setPage] = React.useState<Page | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [placing, setPlacing] = React.useState(false);
  const [pasteNote, setPasteNote] = React.useState<string | null>(null);
  // "Send by email" (D8) — the same grant as replying: the Client inbox
  // (MOD-64C). The route checks `edit`, exactly as it does for a reply.
  const [emailing, setEmailing] = React.useState<Message | null>(null);
  const canEmail = useCanUseModule("MOD-64C");
  const scroller = React.useRef<HTMLDivElement>(null);
  const box = React.useRef<HTMLTextAreaElement>(null);
  const fileOpen = React.useRef<(() => void) | null>(null);
  // A ref as well as the state: two quick Enters land before `busy` re-renders.
  const sending = React.useRef(false);
  // Quick replies are Smart Comms' (MOD-64); the tools offer them to its holders.
  const phrasesOn = useCanUseModule("MOD-64");
  // Filing a file on a quote request is the intake register's (MOD-20).
  const canFileOnRequest = useCanUseModule("MOD-20");
  const [filing, setFiling] = React.useState<ChatFile | null>(null);
  // Held in a ref: a parent passing an inline arrow must not change `load`'s
  // identity on every render — that would restart the poll, re-read, notify
  // the parent, re-render it, and go round again.
  const activity = React.useRef(onActivity);
  activity.current = onActivity;

  const q = `client_id=${encodeURIComponent(clientId)}`;

  const loadThreads = React.useCallback(() => {
    tenant<Thread[]>(`/portal/chat/threads?${q}`)
      .then(setThreads)
      .catch((e) => setError(errMsg(e)));
  }, [q]);

  const load = React.useCallback(
    async (markRead: boolean) => {
      try {
        const p = await tenant<Page>(`/portal/chat/messages?${q}&thread=${encodeURIComponent(thread)}`);
        setPage(p);
        setError(null);
        // Reading the conversation is what the client sees as "seen".
        if (markRead && p.messages.some((m) => m.direction === "CLIENT")) {
          await tenant(`/portal/chat/read`, { method: "POST", body: { client_id: clientId, thread } });
          loadThreads();
          activity.current?.();
        }
      } catch (e) {
        setError(errMsg(e));
      }
    },
    [q, thread, clientId, loadThreads],
  );

  // A live arrival about this client, or a bell click on this page, re-reads
  // the conversation now rather than at the next poll (item 1.6).
  useRefreshEvent((d) => {
    if (d.scope === "screen" || !d.clientId || d.clientId === clientId) {
      loadThreads();
      void load(true);
    }
  });

  React.useEffect(() => {
    setPage(null);
    loadThreads();
    void load(true);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load, loadThreads]);

  /*
   * Follow the conversation, but only when the reader is already at the bottom,
   * and only by moving THIS pane. It used to call `scrollIntoView`, which also
   * scrolls every ancestor: on a client's Messages tab the whole page jumped to
   * the last message each time the poll brought a new one, including while
   * somebody was reading back through last week.
   */
  const followed = React.useRef(false);
  const nearBottom = React.useRef(true);
  React.useEffect(() => {
    followed.current = false;
    nearBottom.current = true;
  }, [thread]);
  const count = page?.messages.length || 0;
  React.useEffect(() => {
    const el = scroller.current;
    if (!el || !count) return;
    if (!followed.current || nearBottom.current) {
      el.scrollTop = el.scrollHeight;
      followed.current = true;
    }
  }, [count, thread]);

  // The box grows with the reply, up to its cap, as Chat's does.
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    // +2 for the border: `scrollHeight` stops inside it, and a box two pixels
    // short of its content shows a scrollbar for one line of text.
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft]);

  /**
   * Deferred, like the vault upload: the reply text travels with the file in
   * one request, so the file waits for Send. The preview and the compression
   * happen the moment it is picked.
   */
  const upload = useUpload<Message>({
    profile: "document",
    autoStart: false,
    maxBytes: 10 * 1024 * 1024,
    send: (file, ctx) =>
      uploadFile<Message>("/tenant/portal/chat/messages", file, {
        fields: { client_id: clientId, thread, body: draft.trim() || undefined },
        onProgress: ctx.onProgress,
        signal: ctx.signal,
      }),
  });

  /** After anything is sent: the conversation, the tabs, and whoever is listening. */
  async function sent() {
    await load(false);
    loadThreads();
    activity.current?.();
  }

  async function send() {
    const body = draft.trim();
    const withFile = upload.items.length > 0;
    if (sending.current || (!body && !withFile)) return;
    sending.current = true;
    setBusy(true);
    try {
      if (withFile) {
        const { ok } = await upload.start();
        if (!ok) return;
        upload.reset();
      } else {
        await tenant("/portal/chat/messages", { method: "POST", body: { client_id: clientId, thread, body } });
      }
      setDraft("");
      setPasteNote(null);
      // Their own reply is what they are waiting to see, wherever they had scrolled to.
      nearBottom.current = true;
      await sent();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  /** A voice note goes the moment the recording stops, as in the team chat. */
  async function sendVoice(rec: Recording) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      const ext = rec.mimeType.includes("mp4") ? "m4a" : rec.mimeType.includes("ogg") ? "ogg" : "webm";
      await uploadFile<Message>(
        "/tenant/portal/chat/messages",
        new File([rec.blob], `voice-note.${ext}`, { type: rec.mimeType }),
        { fields: { client_id: clientId, thread, duration_ms: Math.round(rec.durationMs) } },
      );
      nearBottom.current = true;
      await sent();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function sendPlace(place: SharedPlace) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      await tenant("/portal/chat/messages", {
        method: "POST",
        body: { client_id: clientId, thread, lat: place.lat, lng: place.lng, location_label: place.label || undefined },
      });
      setPlacing(false);
      nearBottom.current = true;
      await sent();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  /** Put text where the cursor is — an emoji, or a quick reply. */
  function insert(text: string) {
    const el = box.current;
    const at = el ? el.selectionStart ?? draft.length : draft.length;
    const to = el ? el.selectionEnd ?? at : at;
    const next = draft.slice(0, at) + text + draft.slice(to);
    setDraft(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(at + text.length, at + text.length);
    });
  }

  /*
   * One tab per conversation. The one that is open always has a tab, even
   * before the list of conversations has arrived and even when it is not in
   * it: a link from an alert can name a shipment nobody has written in yet,
   * and a tab strip with nothing selected does not say where the reader is.
   */
  const tabs: TabItem[] = [
    { value: "general", label: tr("General"), count: threads.find((x) => !x.dossier_id)?.unread || undefined },
    ...threads
      .filter((x) => x.dossier_id)
      .map((x) => ({ value: x.dossier_id as string, label: x.dossier_ref || tr("Shipment"), count: x.unread || undefined })),
  ];
  if (!tabs.some((x) => x.value === thread)) tabs.push({ value: thread, label: page?.dossier_ref || tr("Shipment") });

  /*
   * The floating actions on a phone land where this row's Send button is. Only
   * where the panel fills the screen (the Client inbox) is the box docked at
   * the bottom of the viewport, so only there does it ask them to move up; on
   * a client's Messages tab it scrolls with the page and asks for nothing.
   */
  const composer = React.useRef<HTMLDivElement>(null);
  const noFloor = React.useRef<HTMLDivElement>(null);
  useFabFloor(fill ? composer : noFloor);

  const info = <AccountManagerCard clientId={clientId} onChange={() => activity.current?.()} className="rounded-none border-0 bg-transparent" />;

  /*
   * A SIBLING of the name or the tabs it sits beside, never inside them: an
   * icon button nested in a heading joins that heading's accessible name.
   */
  const infoButton = (
    <button
      type="button"
      className={cn(ROUND_BUTTON, "h-9 w-9", infoOpen && "bg-accent text-foreground")}
      aria-label={tr("Conversation Info")}
      title={tr("Conversation Info")}
      aria-expanded={infoOpen}
      aria-controls={infoBeside && infoOpen ? infoId : undefined}
      onClick={() => setInfoOpen(!infoOpen)}
    >
      <InfoIcon width={18} height={18} />
    </button>
  );

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0",
        fill ? "flex-1" : "chat-shell h-[70vh] max-h-[680px] min-h-[420px] overflow-hidden rounded-2xl border border-border bg-card",
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {header ? (
          <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-3 py-2.5">
            {header}
            {infoButton}
          </div>
        ) : null}
        <TabsRoot
          value={thread}
          onValueChange={setThread}
          // Arrows move along the tabs and Enter opens one: opening a
          // conversation reads it, and reading it tells the client it was seen.
          activationMode="manual"
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* On the page ground, not the card's: the strip fades its ends into
              `--background` where it overflows on a phone, and the messages
              under it sit on that same ground. */}
          <div className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-2">
            <div className="min-w-0 flex-1">
              <TabList tabs={tabs} label={tr("Conversation")} className="mb-0 border-b-0" />
            </div>
            {header ? null : infoButton}
          </div>
          <TabsContent value={thread} className="flex min-h-0 flex-1 flex-col focus-visible:outline-none">
            <div
              ref={scroller}
              onScroll={(e) => {
                const el = e.currentTarget;
                nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
              }}
              className={cn(
                "chat-thread-bg min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6",
                // @dash:keep a CSS class name (the photo backdrop, index.css), not copy
                wallpaper && "chat-thread-bg--photo",
              )}
              style={wallpaper ? ({ "--chat-thread-image": `url("${wallpaper}")` } as React.CSSProperties) : undefined}
            >
              {error && !page ? (
                <ErrorState message={error} />
              ) : !page ? (
                <LoadingRow label={tr("Loading…")} />
              ) : !page.messages.length ? (
                <div className="flex h-full items-center justify-center">
                  <EmptyState className="border-0" title={t("support.noMessages")} hint={t("support.noMessagesHint")} />
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {page.messages.map((m) => (
                    <Bubble
                      key={m.message_id}
                      m={m}
                      onEmail={canEmail ? setEmailing : undefined}
                      onFile={canFileOnRequest ? setFiling : undefined}
                    />
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>
        </TabsRoot>
        <div ref={composer} data-composer className="relative max-h-[50%] shrink-0 overflow-y-auto border-t border-border bg-card">
          {upload.items.length ? (
            <div className="border-b border-border px-3 py-2">
              <UploadList items={upload.items} onRemove={upload.remove} onRetry={upload.retry} />
            </div>
          ) : null}
          <div className="flex items-end gap-2 px-2 py-2">
            <ClientChatTools
              disabled={busy}
              onFile={() => {
                setPasteNote(null);
                fileOpen.current?.();
              }}
              onLocation={() => setPlacing(true)}
              onEmoji={insert}
              onPhrase={insert}
              phrases={phrasesOn}
            />
            {/* The engine's picker, opened from the + menu — preview, percentage
                and compression all still come from it. */}
            <div className="hidden">
              <FilePicker
                variant="inline"
                openRef={fileOpen}
                accept={ACCEPT}
                onPaste={false}
                label={tr("Photo or document")}
                disabled={busy}
                onPick={(files) => void upload.pick(files)}
              />
            </div>
            <div
              className="min-w-0 flex-1"
              onPaste={(e) => {
                if (busy) return;
                const result = pasteFileFromEvent(e, ACCEPT);
                if (result.kind === "accepted") {
                  e.preventDefault();
                  setPasteNote(null);
                  void upload.pick([result.file]);
                } else if (result.kind === "rejected") {
                  e.preventDefault();
                  setPasteNote(tr("That file type isn't accepted here: choose a file instead."));
                }
              }}
            >
              <Textarea
                ref={box}
                rows={1}
                // Chat's message box: the same round corners, the same ring, the
                // same height. The hint goes when the box is clicked into, as
                // Chat's does: words left under the cursor read as words typed.
                className="max-h-32 min-h-10 resize-none rounded-2xl text-sm focus-visible:ring-2 focus-visible:ring-ring focus:placeholder:text-transparent"
                value={draft}
                onChange={(e) => {
                  setPasteNote(null);
                  setDraft(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={t("support.replyPlaceholder")}
                aria-label={t("support.replyPlaceholder")}
                // Read-only while sending, not disabled: disabling drops focus,
                // and the next line should be typed without reaching for the box.
                readOnly={busy}
              />
            </div>
            {draft.trim() || upload.items.length ? (
              <Button size="sm" icon={null} onClick={() => void send()} loading={busy}>
                {t("support.sendReply")}
              </Button>
            ) : (
              <VoiceRecorder onRecorded={(rec) => void sendVoice(rec)} disabled={busy} />
            )}
          </div>
          {/* Only when a paste was refused. "Enter to send · Shift + Enter for a
              new line" used to stand here under every reply; Chat dropped the
              same line on 17 Nov 2026 at the tenant's request, and Enter sending
              is what every chat does. */}
          {pasteNote ? (
            <p className="px-14 pb-2 text-[10px] text-destructive" role="status">
              {pasteNote}
            </p>
          ) : null}
        </div>
      </div>
      {infoBeside && infoOpen ? (
        <aside
          id={infoId}
          aria-label={tr("Conversation Info")}
          className="flex w-[300px] shrink-0 flex-col overflow-hidden border-l border-border"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <h3 className="text-sm font-semibold">{tr("Conversation Info")}</h3>
            <Button size="sm" variant="ghost" onClick={() => setInfoOpen(false)}>
              {tr("Hide")}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{info}</div>
        </aside>
      ) : null}
      {infoBeside ? null : (
        <Dialog open={infoOpen} onClose={() => setInfoOpen(false)} title={tr("Conversation Info")} placement="right" bodyClassName="p-0">
          {info}
        </Dialog>
      )}
      <ShareLocationDialog open={placing} onClose={() => setPlacing(false)} onSend={(p) => void sendPlace(p)} busy={busy} />
      <SendByEmailDialog message={emailing} onClose={() => setEmailing(null)} onSent={() => void load(false)} />
      {canFileOnRequest ? <FileOnQuoteRequestDialog clientId={clientId} file={filing} onClose={() => setFiling(null)} /> : null}
    </div>
  );
}
