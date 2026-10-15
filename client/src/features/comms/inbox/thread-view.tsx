/**
 * One conversation, opened: every message in order, oldest first.
 *
 * ── OLDEST FIRST, AND THE LAST ONE EXPANDED ─────────────────────────────────
 *
 * A conversation is read the way it happened. Collapsing everything but the
 * latest message is the convention every mail client settled on for the same
 * reason: the thing you came for is almost always the newest thing, and the
 * history is context you want available rather than in your way.
 *
 * ── THE ORIGIN TAG IS SHOWN, NOT HIDDEN ─────────────────────────────────────
 *
 * PR-0 stamps every outbound message with where it was sent from, so a reply a
 * colleague typed on their phone appears here labelled as such. That answers
 * "did anyone reply to this?" without anyone having to ask in chat — which was
 * the actual request behind the whole origin-tagging design.
 *
 * ── HTML BODIES ARE SANITIZED ON INGEST, AND RENDERED IN A SEALED FRAME ─────
 *
 * `body-html.js` (`cleanHtml`) runs once when the message is stored, so what
 * is in the database is already safe to keep. Since 14410 it keeps the
 * sender's styling, `<style>` blocks included, which makes the second half of
 * the invariant as important as the first: `body_html` is NEVER handed to
 * `dangerouslySetInnerHTML` in the app's own document. It goes through
 * `EmailFrame`, where its CSS can only reach itself and nothing in it runs.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { MoreMenu } from "@/components/ui/more-menu";
import { DropdownItem, DropdownSeparator } from "@/components/ui/dropdown-menu";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { dateTimeFmt } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { Dialog } from "@/components/ui/dialog";
import { ResponsiveImage } from "@/components/ui/responsive-image";
import type { Attachment, Label, MailFolder, MailStream, Message, ThreadDetail } from "@/lib/mail-api";
import {
  attachmentObjectUrl,
  downloadAttachment,
  downloadMessageSource,
  getMessageBody,
  listMsgAttachments,
  messageSourceText,
  trustImageSender,
} from "@/lib/mail-api";
import { useObjectUrl } from "../chat/use-object-url";
import { NewMessageDialog } from "./composer/new-message";
import { SignatureSlot } from "./composer/signature-slot";
import { WorkRail } from "./work";
import { VerdictBanner, VerdictPill } from "./work/guardrails";
import { Extractions } from "./work/intake";
import {
  matchInlineParts,
  referencedCids,
  renderBody,
  splitQuotedHtml,
  splitQuotedText,
  styleBlocks,
} from "./message-body";
import { EmailFrame } from "./email-frame";
import type { Mailto } from "./email-doc";
import { useEmailPalette, type EmailPalette } from "./email-ink";

const Composer = React.lazy(() => import("./composer"));

const MOVE_TO: MailFolder[] = ["INBOX", "ARCHIVE", "SPAM", "TRASH"];

/** Where the work rail's open/closed preference lives. Sibling of
 *  `comms:info-open`, which the chat's info panel already uses. */
const RAIL_PREF = "comms:work-rail-open";

/**
 * What a COLLAPSED rail still has to say.
 *
 * Collapsing the panel must not collapse the two facts an operator scans a
 * thread for. An overdue first reply is the one with a deadline attached, so it
 * wins; an unbound thread is the one where everything downstream — the dossier,
 * the action cards, the 360 timeline — is empty until somebody says what this
 * is about (§7.1). Either way the mark is a glyph rather than a count: there is
 * no number here, and a "1" would invite the reader to look for a list.
 *
 * Returns null when the thread is bound and on time — a badge that is always
 * present is not a signal.
 */
function railAttention(thread: ThreadDetail): { mark: string; tone: "bad" | "info"; label: string } | null {
  if (thread.sla_breached) {
    return { mark: "!", tone: "bad", label: tr("A first reply is overdue") }; // @prose:keep a statement about this thread, not a name
  }
  if (!thread.entity_ref) {
    return { mark: "?", tone: "info", label: tr("Not linked to a client or a file yet") }; // @prose:keep a statement about this thread, not a name
  }
  return null;
}

/** PR-0 origin tag → what to actually show a person. */
function originNote(m: Message): string | null {
  if (m.direction !== "OUT") return null;
  const via = String(m.sent_via || "").toUpperCase();
  if (!via || via === "PRAXIS") return null;
  return tr("Sent from another device");
}

/** Bytes → the shortest honest string. Attachment sizes are the one number in
 *  this pane a person compares at a glance ("is that the 12 MB scan?"). */
function sizeLabel(bytes?: number | null): string {
  const n = Number(bytes || 0);
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A message's attachments, fetched once when it is opened (audit H-2).
 *
 * Before H-2, `has_attachment` rendered a pill reading "Attachment" and that
 * was the entire feature: the product could tell you a bill of lading had
 * arrived and could not show it to you.
 *
 * Fetched lazily, per message, only when the message is expanded and only when
 * it actually has one. A thread of forty messages must not fire forty requests
 * to draw a pane where thirty-nine of them are collapsed. The one list feeds
 * both the strip and the inline images in the body, so it is fetched once.
 */
function useMessageAttachments(messageId: string, wanted: boolean) {
  const [rows, setRows] = React.useState<Attachment[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    listMsgAttachments(messageId)
      .then((r) => { if (live) setRows(r || []); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [messageId, wanted]);
  return { rows, failed };
}

/**
 * Object URLs for the inline images the body references, revoked on unmount.
 *
 * Only the parts the body actually draws are fetched, and they are fetched
 * whether or not remote images are allowed: an inline part arrived WITH the
 * message and is served from our own store, so it reports to nobody.
 */
function useInlineImages(rows: Attachment[] | null, html: string) {
  const cids = React.useMemo(() => referencedCids(html), [html]);
  const matches = React.useMemo(() => matchInlineParts(rows || [], cids), [rows, cids]);
  const [urls, setUrls] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!matches.length) {
      setUrls({});
      return undefined;
    }
    let live = true;
    const controller = new AbortController();
    const made: string[] = [];
    Promise.all(
      matches.map(({ cid, part }) =>
        attachmentObjectUrl(part.email_attachment_id, controller.signal)
          .then((url) => {
            made.push(url);
            return [cid, url] as const;
          })
          .catch(() => {
            /* @silent:parse the defined fallback: this cid stays unresolved and
               draws as the broken image it always was, without costing the
               other images in the message */
            return null;
          }),
      ),
    ).then((pairs) => {
      if (!live) return;
      setUrls(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => p !== null)));
    });
    return () => {
      live = false;
      controller.abort();
      for (const u of made) URL.revokeObjectURL(u);
    };
  }, [matches]);

  const drawn = React.useMemo(() => new Set(matches.map((m) => m.part.email_attachment_id)), [matches]);
  return { urls, drawn };
}

const isImage = (a: Attachment) => /^image\//i.test(String(a.content_type || ""));

/** An image attachment shows itself, as Outlook does, so the wrong scan is caught at a glance. */
function AttachmentThumb({ attachment }: { attachment: Attachment }) {
  const { url } = useObjectUrl((signal) => attachmentObjectUrl(attachment.email_attachment_id, signal));
  if (!url) return <span aria-hidden className="block h-16 w-24 rounded bg-muted" />;
  return (
    <ResponsiveImage
      src={url}
      alt=""
      className="h-16 w-24 rounded object-cover"
    />
  );
}

/**
 * The strip of files on a message.
 *
 * Inline images the body draws in place are not listed: they are part of the
 * message, not something the sender attached. An inline part the body does
 * NOT reference is listed, because otherwise it would be nowhere.
 *
 * A failure renders as a readable line rather than an empty space, because the
 * empty space is indistinguishable from "this message has no attachments".
 */
function AttachmentStrip({ rows, failed, drawn }: { rows: Attachment[] | null; failed: boolean; drawn: Set<string> }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [downloadFailed, setDownloadFailed] = React.useState(false);

  if (failed || downloadFailed) {
    return (
      <p className="text-xs text-muted-foreground">
        {tr("Could not load the attachments on this message.")}
      </p>
    );
  }
  if (!rows) return <LoadingRow />;
  const files = rows.filter((a) => !drawn.has(a.email_attachment_id));
  if (!files.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((a) => {
        const size = sizeLabel(a.size_bytes);
        const open = () => {
          setBusy(a.email_attachment_id);
          downloadAttachment(a.email_attachment_id, a.filename)
            .catch(() => setDownloadFailed(true))
            .finally(() => setBusy(null));
        };
        if (isImage(a) && Number(a.size_bytes || 0) <= 10 * 1024 * 1024) {
          return (
            <button
              key={a.email_attachment_id}
              type="button"
              disabled={busy === a.email_attachment_id}
              onClick={open}
              title={a.filename || tr("Attachment")}
              className="flex flex-col items-start gap-1 rounded-md border border-border p-1 text-left hover:bg-muted disabled:opacity-60"
            >
              <AttachmentThumb attachment={a} />
              <span className="flex max-w-[6rem] items-baseline gap-1 text-xs">
                <span className="truncate">{a.filename || tr("Attachment")}</span>
                {size && <span className="num shrink-0 text-muted-foreground">{size}</span>}
              </span>
            </button>
          );
        }
        return (
          <Button
            key={a.email_attachment_id}
            size="sm"
            variant="outline"
            disabled={busy === a.email_attachment_id}
            onClick={open}
          >
            <span className="truncate max-w-[16rem]">{a.filename || tr("Attachment")}</span>
            {size && <span className="num ml-1.5 text-xs text-muted-foreground">{size}</span>}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * The message itself: drawn as its sender made it, images held back until
 * trusted or asked for, history folded.
 *
 * ── A SEALED FRAME, NOT THE APP'S OWN DOCUMENT ──────────────────────────────
 *
 * The pane used to hand `body_html` to `dangerouslySetInnerHTML`, inside a
 * Tailwind `prose` wrapper, so a sender's email arrived in our fonts and our
 * colours with the layout stripped (and the ingest sanitizer had already taken
 * the styling off before it was stored). Bodies now keep their CSS, and CSS
 * that shares our document can restyle or cover it, so every HTML body goes
 * through `EmailFrame`. See that file for the sandbox and its policy.
 *
 * ── LIGHT MODE IS THE ORIGINAL; DARK MODE IS RECOLOURED ─────────────────────
 *
 * Owner decision, 15 Oct 2026: follow the reader's mode, recolour like new
 * Outlook in dark, and no per-message switch. `email-dark.ts` has the rules.
 *
 * ── IMAGES ──────────────────────────────────────────────────────────────────
 *
 * Remote images stay blocked until the reader asks, unless the server says
 * this reader trusts the sender (their own list, a party we know, our own
 * domain, or mail we sent; never a sender who failed verification). "Always
 * show from this sender" is §5.6.3's per-sender switch, stored per user and
 * withdrawn from My Mailbox. Inline `cid:` images are always drawn: they came
 * with the message.
 *
 * ── REPAIR ON OPEN ──────────────────────────────────────────────────────────
 *
 * A body stored before formatting was kept has no `body_policy`. It is drawn as
 * stored at once, the server is asked to repair it, and the repaired body
 * replaces it when it lands. A failed repair changes nothing on screen.
 */
function MessageBody({
  message,
  palette,
  attachments,
  trustedSenders,
  onTrust,
  onMailto,
  onRepaired,
}: {
  message: Message;
  palette: EmailPalette;
  attachments: Attachment[] | null;
  trustedSenders: Set<string>;
  onTrust: (sender: string) => Promise<void>;
  onMailto: (m: Mailto) => void;
  onRepaired: (messageId: string, html: string) => void;
}) {
  const [asked, setAsked] = React.useState(false);
  const [showQuote, setShowQuote] = React.useState(false);
  const [trusting, setTrusting] = React.useState<"idle" | "busy" | "failed">("idle");
  const [repaired, setRepaired] = React.useState<string | null>(null);
  const [, setRepair] = React.useState<"idle" | "done" | "failed">("idle");

  const stored = message.body_html || "";
  const html = repaired ?? stored;
  const needsRepair = Boolean(stored) && (message.body_policy === null || message.body_policy === undefined);

  React.useEffect(() => {
    if (!needsRepair) return undefined;
    let live = true;
    getMessageBody(message.email_message_id)
      .then((r) => {
        if (!live) return;
        setRepair("done");
        if (r && r.body_html && (r.source === "recleaned" || r.source === "provider")) {
          setRepaired(r.body_html);
          onRepaired(message.email_message_id, r.body_html);
        }
      })
      // The stored body is already on screen; a repair that did not happen
      // leaves it there, which is the state the reader had before.
      .catch(() => { if (live) setRepair("failed"); });
    return () => { live = false; };
    // onRepaired is the parent's setter wrapper; re-running on its identity
    // would re-request the repair on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.email_message_id, needsRepair]);

  const sender = String(message.from_address || "").toLowerCase();
  const trust = message.image_trust;
  const held = trust?.reason === "held";
  const trusted = !held && (Boolean(trust?.trusted) || trustedSenders.has(sender));
  const showRemote = asked || trusted;

  const { urls } = useInlineImages(attachments, html);
  const parts = React.useMemo(
    () => (html ? splitQuotedHtml(html) : splitQuotedText(message.body_text || "")),
    [html, message.body_text],
  );
  const styles = React.useMemo(() => (html ? styleBlocks(html) : ""), [html]);
  const opts = { showRemote, cidUrls: urls, dark: palette.dark };
  const visible = React.useMemo(
    () => (html ? renderBody(parts.visible, opts) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [html, parts.visible, showRemote, urls, palette],
  );
  const quoted = React.useMemo(
    () => (html && parts.quoted ? renderBody(styles + parts.quoted, opts) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [html, parts.quoted, styles, showRemote, urls, palette],
  );

  const blocked = (visible?.blocked || 0) + (quoted?.blocked || 0);
  const scheme = palette.scheme;
  const who = message.direction === "OUT"
    ? tr("Your message")
    : `${tr("Message from")} ${message.from_name || message.from_address}`;
  // Offered for a stranger only. Mail we sent needs no trust, and a sender who
  // failed verification must not be one click from permanent trust.
  const canTrust = message.direction === "IN" && !held && Boolean(sender);

  const trustSender = () => {
    setTrusting("busy");
    onTrust(sender)
      .then(() => setTrusting("idle"))
      .catch(() => setTrusting("failed"));
  };

  return (
    <div className="space-y-2">
      {blocked > 0 && !showRemote && (
        // Named and counted. "Images blocked" with no number reads as a setting;
        // "3 images" reads as a message that has something in it.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          <span>
            {held
              ? tr("Images are held back: this sender could not be verified.")
              : blocked === 1
                ? tr("One image was not loaded. Remote images can tell the sender you opened this.")
                : `${blocked} ${tr("images were not loaded. Remote images can tell the sender you opened this.")}`}
          </span>
          <button
            type="button"
            onClick={() => setAsked(true)}
            className="font-medium text-foreground underline underline-offset-2"
          >
            {tr("Show images")}
          </button>
          {canTrust && (
            <button
              type="button"
              onClick={trustSender}
              disabled={trusting === "busy"}
              className="font-medium text-foreground underline underline-offset-2 disabled:opacity-60"
            >
              {`${tr("Always show from")} ${message.from_address}`}
            </button>
          )}
          {trusting === "failed" && <span>{tr("Could not remember this sender. Try again.")}</span>}
        </div>
      )}

      {visible ? (
        <EmailFrame
          html={visible.html}
          title={who}
          showRemote={showRemote}
          ink={palette.ink}
          scheme={scheme}
          onMailto={onMailto}
        />
      ) : (
        <div className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
          {parts.visible || message.body_preview || tr("(no content)")}
        </div>
      )}

      {parts.quoted && (
        <div>
          {/* The ellipsis every mail client uses, because everybody already
              knows what it means. Folded, never dropped: this is the record of
              who said what, and it stays one click away. */}
          <button
            type="button"
            onClick={() => setShowQuote((v) => !v)}
            aria-expanded={showQuote}
            className="rounded border border-border px-2 py-0.5 text-xs leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
            title={showQuote ? tr("Hide the earlier messages") : tr("Show the earlier messages")}
          >
            {showQuote ? tr("Hide earlier messages") : "···"}
          </button>
          {showQuote && (
            quoted ? (
              <div className="mt-2 border-l-2 border-border pl-3">
                <EmailFrame
                  html={quoted.html}
                  title={tr("Earlier messages")}
                  showRemote={showRemote}
                  ink={palette.ink}
                  scheme={scheme}
                  onMailto={onMailto}
                />
              </div>
            ) : (
              <div className="mt-2 whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {parts.quoted}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

/**
 * View source: the message exactly as the mail server holds it.
 *
 * Read from the provider each time, never stored (see body.service). Shown as
 * text with a size limit, because a message with a 20 MB attachment is 27 MB of
 * base64 and a `<pre>` of that hangs the tab; the download has all of it.
 */
const SOURCE_SHOWN = 2 * 1024 * 1024;

function SourceDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const [text, setText] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const filename = emlName(message.subject);

  React.useEffect(() => {
    const controller = new AbortController();
    messageSourceText(message.email_message_id, controller.signal)
      .then(setText)
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        const status = (e as { status?: number } | null)?.status;
        setError(status === 404
          ? tr("The mail server no longer has the original of this message.")
          : tr("Could not load the original of this message."));
      });
    return () => controller.abort();
  }, [message.email_message_id]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={tr("Message Source")}
      size="wide"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{tr("Close")}</Button>
          <Button
            disabled={!text}
            onClick={() => { downloadMessageSource(message.email_message_id, filename).catch(() => setError(tr("Could not load the original of this message."))); }}
          >
            {tr("Download Original")}
          </Button>
        </>
      }
    >
      {error ? (
        <ErrorState message={error} />
      ) : text === null ? (
        <LoadingRow label={tr("Loading the original…")} />
      ) : (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">
          {text.length > SOURCE_SHOWN ? text.slice(0, SOURCE_SHOWN) : text}
        </pre>
      )}
    </Dialog>
  );
}

/** The downloaded original's name: the subject, folded to what a file system accepts. */
function emlName(subject?: string | null): string {
  const base = String(subject || "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "message"}.eml`;
}

function MessageBlock({
  message,
  defaultOpen,
  repairedHtml,
  palette,
  trustedSenders,
  onTrust,
  onMailto,
  onRepaired,
}: {
  message: Message;
  defaultOpen: boolean;
  /** The body as repaired on open, once it has landed; decides which inline parts the body draws. */
  repairedHtml?: string;
  palette: EmailPalette;
  trustedSenders: Set<string>;
  onTrust: (sender: string) => Promise<void>;
  onMailto: (m: Mailto) => void;
  onRepaired: (messageId: string, html: string) => void;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [source, setSource] = React.useState(false);
  const origin = originNote(message);
  // Same reasoning as counterparties() in thread-list: guard the shape rather
  // than trust it, because the cost of being wrong here is the whole screen.
  const to = Array.isArray(message.to_address) ? message.to_address : [];
  const cc = Array.isArray(message.cc_address) ? message.cc_address : [];
  const who =
    message.direction === "OUT"
      ? `${tr("To")} ${to.join(", ") || "—"}`
      : `${tr("From")} ${message.from_name ? `${message.from_name} <${message.from_address}>` : message.from_address}`;

  // Wanted for the strip AND for inline images, which can exist on a message
  // whose only "attachments" are the pictures in its signature. Read off the
  // repaired body when there is one: a pre-14410 IMAP body lost its `cid:`
  // references, and only the repaired copy says which parts it draws.
  const bodyHtml = repairedHtml || message.body_html || "";
  const wantsParts = open && (message.has_attachment || /cid:/i.test(bodyHtml));
  const { rows, failed } = useMessageAttachments(message.email_message_id, wantsParts);
  const drawn = React.useMemo(
    () => new Set(matchInlineParts(rows || [], referencedCids(bodyHtml)).map((m) => m.part.email_attachment_id)),
    [rows, bodyHtml],
  );

  return (
    <article
      className={cn(
        "min-w-0 rounded-lg border border-border",
        message.is_read ? "bg-card/40" : "bg-card",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{who}</span>
          {!open && (
            <span className="block truncate text-xs text-muted-foreground">
              {message.body_preview || "—"}
            </span>
          )}
        </span>
        <span className="num shrink-0 text-xs text-muted-foreground">
          {dateTimeFmt(message.received_at)}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={message.direction === "OUT" ? "blue" : "mute"}>
              {message.direction === "OUT" ? tr("Sent") : tr("Received")}
            </Pill>
            <Pill tone="mute">{message.folder}</Pill>
            {origin && <Pill tone="warn">{origin}</Pill>}
            {/* The pill stays as the at-a-glance marker; the strip below is the
                part that was missing (H-2). */}
            {message.has_attachment && <Pill tone="mute">{tr("Attachment")}</Pill>}
            {/* §9.7. Absent verdict renders nothing — see the type. A green
                tick for "we did not check" would be the worst of the three
                possible outputs. */}
            <VerdictPill verdict={message.auth_verdict} />
            {/* Outlook's "View message source" and Gmail's "Show original":
                the message as the server holds it, read live, never stored. */}
            <MoreMenu label={tr("Message actions")} className="ml-auto">
              <DropdownItem onSelect={() => setSource(true)}>{tr("View source")}</DropdownItem>
              <DropdownItem
                onSelect={() => { downloadMessageSource(message.email_message_id, emlName(message.subject)).catch(() => setSource(true)); }}
              >
                {tr("Download original")}
              </DropdownItem>
            </MoreMenu>
          </div>

          {message.has_attachment && <AttachmentStrip rows={rows} failed={failed} drawn={drawn} />}

          <VerdictBanner
            verdict={message.auth_verdict}
            detail={
              typeof message.auth_detail?.reason === "string"
                ? message.auth_detail.reason
                : null
            }
          />
          {cc.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {tr("Cc")}: <span className="num">{cc.join(", ")}</span>
            </p>
          )}
          <MessageBody
            message={message}
            palette={palette}
            attachments={rows}
            trustedSenders={trustedSenders}
            onTrust={onTrust}
            onMailto={onMailto}
            onRepaired={onRepaired}
          />

          {/* §8.6 — whatever was read off this message's attachments, staged
              and awaiting a person. Renders nothing when there is nothing. */}
          {message.has_attachment && (
            <Extractions messageId={message.email_message_id} />
          )}
        </div>
      )}
      {source && <SourceDialog message={message} onClose={() => setSource(false)} />}
    </article>
  );
}

export function ThreadView({
  thread,
  loading,
  error,
  labels,
  folder,
  onMove,
  onStream,
  onLabel,
  onToggleRead,
  onDelete,
  onClose,
  onReplied,
  onWorkChanged,
  busy,
}: {
  thread: ThreadDetail | null;
  loading: boolean;
  error?: string | null;
  labels: Label[];
  /**
   * Which folder is being read. Decides whether Archive and each "Move to" are
   * offered — moving a conversation to the folder it is already in is a no-op
   * dressed as an action, which is the rule `ThreadList`'s BULK list already
   * applies to the same four verbs. Undefined while reading a saved view or a
   * label, which cut across folders: everything is then offered, because there
   * is no current folder for anything to be a no-op in.
   */
  folder?: MailFolder;
  onMove: (folder: MailFolder) => void;
  onStream: (stream: MailStream) => void;
  onLabel: (labelId: string) => void;
  onToggleRead: (read: boolean) => void;
  /**
   * Delete this conversation for ever. Absent = not offered.
   *
   * Only supplied while reading Trash or Spam, where "move to Trash" is a
   * no-op and permanent deletion is the only remaining thing to want. The
   * server is retention-aware — anything sealed into `email_archive` is kept
   * and counted — so the caller reports what actually happened rather than
   * assuming a success.
   */
  onDelete?: () => void;
  onClose: () => void;
  /** Called once a reply is accepted into the send queue, so the list refreshes. */
  onReplied?: () => void;
  /**
   * Anything in the work rail changed the thread — a binding, a claim, a
   * status, a visibility. Reloads the thread AND the list, because most of
   * these are visible in both and a rail that updated only its own half would
   * leave the list showing the previous assignee.
   */
  onWorkChanged?: () => void;
  busy: boolean;
}) {
  // Declared before the early returns below, because hooks cannot be conditional.
  const [replying, setReplying] = React.useState<null | "REPLY" | "REPLY_ALL" | "FORWARD">(null);
  React.useEffect(() => { setReplying(null); }, [thread?.email_thread_id]);

  /* ── THE WORK RAIL COLLAPSES AS A WHOLE (review 16 Sep 2026 #22) ───────────
   *
   * The rail's SECTIONS already collapse — it is an accordion and opens closed.
   * The rail itself did not, so 22rem of every wide screen was spent on triage
   * controls whether or not the reader was triaging, and the correspondence —
   * the thing they opened the thread for — got what was left.
   *
   * DEFAULT COLLAPSED, as asked. Reading is the common case and the rail's
   * contents are an action, not context.
   *
   * The choice is a PREFERENCE, not per-thread state: someone who works the
   * queue wants it open on every thread, and someone who reads wants it shut on
   * every thread. It is therefore NOT reset when the thread changes (unlike
   * `replying` above, which must be) and it is remembered across sessions in
   * localStorage, beside `comms:info-open` which the chat's info panel already
   * uses. A storage failure costs the preference for this visit and nothing
   * else — never the panel.
   */
  const [railOpen, setRailOpen] = React.useState(() => {
    try { return localStorage.getItem(RAIL_PREF) === "true"; }
    catch { return false; /* @silent:storage — default collapsed, as specified */ }
  });
  React.useEffect(() => {
    try { localStorage.setItem(RAIL_PREF, String(railOpen)); }
    catch { /* @silent:storage — the toggle still works for this visit */ }
  }, [railOpen]);

  // The colours every message frame is drawn against, read once per theme.
  const palette = useEmailPalette();

  // Senders trusted from THIS pane, so "Always show from…" on one message
  // shows the images on every other message from them without a reload. The
  // server's own stamp (`image_trust`) covers the rest on the next open.
  const [trustedSenders, setTrustedSenders] = React.useState<Set<string>>(() => new Set());
  // Bodies repaired on open, so Reply quotes the sender's formatting rather
  // than the flattened copy the thread was loaded with.
  const [repaired, setRepaired] = React.useState<Record<string, string>>({});
  // A `mailto:` clicked inside a message, opened in the Praxis composer.
  const [mailto, setMailto] = React.useState<Mailto | null>(null);
  React.useEffect(() => {
    setTrustedSenders(new Set());
    setRepaired({});
    setMailto(null);
  }, [thread?.email_thread_id]);

  const onTrust = React.useCallback(async (sender: string) => {
    await trustImageSender(sender);
    setTrustedSenders((prev) => new Set(prev).add(sender));
  }, []);
  const onRepaired = React.useCallback((id: string, html: string) => {
    setRepaired((prev) => ({ ...prev, [id]: html }));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (loading && !thread) return <LoadingRow label={tr("Opening conversation…")} />;
  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="max-w-reading text-sm text-muted-foreground">
          {tr("Choose a conversation to read it. Everything here is scoped to you: what you have read, what you have starred, and the labels you made.")}
        </p>
      </div>
    );
  }

  const messages = thread.messages || [];
  const lastIndex = messages.length - 1;
  // Computed after the null-guard above, so the collapsed spine can carry it.
  const railBadge = railAttention(thread);

  // Who a reply goes to: the last INBOUND sender, not simply the last message.
  // Replying to your own last message would address the mail to yourself.
  const lastInbound = [...messages].reverse().find((m) => m.direction === "IN");
  const replyTo = lastInbound ? [lastInbound.from_address] : (messages[lastIndex]?.to_address || []);

  /* ── REPLY ALL, and the one address it must never carry ───────────────────
   *
   * Everyone who was on the last inbound message, minus the people already in
   * To, and minus OUR OWN MAILBOX. Leaving ourselves in the Cc of our own reply
   * is the classic reply-all defect: every answer lands back in the inbox it
   * was sent from, the thread doubles, and the unread count is permanently
   * wrong. `mailbox_address` is the one address on the thread that is
   * definitionally us.
   *
   * Compared lower-cased because an address is case-insensitive in its domain
   * and, in practice, everywhere — a Cc reading `Ops@maersk.com` beside a To of
   * `ops@maersk.com` is one recipient, not two, and sending to both is how a
   * counterparty gets the same mail twice.
   */
  const mine = String(thread.mailbox_address || "").toLowerCase();
  const source = lastInbound || messages[lastIndex] || null;
  const replyAllCc = (() => {
    const seen = new Set([mine, ...replyTo.map((a) => a.toLowerCase())]);
    const out: string[] = [];
    for (const a of [
      ...(Array.isArray(source?.to_address) ? source.to_address : []),
      ...(Array.isArray(source?.cc_address) ? source.cc_address : []),
    ]) {
      const k = String(a).toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(a);
    }
    return out;
  })();

  /* A FORWARD carries the message, not the conversation's recipients: the whole
   * point is that it goes to somebody who was not on it. So To starts empty and
   * the operator types who — and the quoted body below is what they are
   * actually sending. Prefixing Fwd: only when it is not already there keeps a
   * twice-forwarded subject from reading "Fwd: Fwd: Fwd:". */
  const subj = thread.subject || "";
  const replySubject = /^re:/i.test(subj) ? subj : `Re: ${subj}`.trim();
  const forwardSubject = /^fwd?:/i.test(subj) ? subj : `Fwd: ${subj}`.trim();

  return (
    /* `h-full`: the last link in the height chain — see inbox/index.tsx and the
       note on ThreadList's root. */
    <div className="flex h-full min-h-0 flex-col">
      {/* ── THE COMMAND STRIP ───────────────────────────────────────────────
       *
       * One compact row holding the four things a reader does to the
       * conversation in front of them, with the rest behind `⋯`.
       *
       * WHAT IT REPLACES. A wrapping row of two buttons and two bare
       * `<select>`s — "Move to…" and "Label…" as placeholder options — mixed in
       * with "This is a person", a full sentence on a button. Six controls of
       * four different shapes, wrapping to three rows at the widths a split
       * reading pane actually gets, above a header that spent `space-y-2` and
       * `py-3` on two lines of text.
       *
       * REPLY IS HERE, NOT ONLY IN THE FOOTER. Reply, Reply all and Forward
       * were the footer's whole contents, which was defensible while the footer
       * was pinned and is the convention Gmail uses — except the footer was
       * never pinned, because nothing on this screen had a height (see
       * inbox/index.tsx). On a forty-message thread the reply buttons sat
       * forty messages down a scrolling page. The footer still holds the
       * composer, and it no longer holds a second copy of these three buttons.
       *
       * ARCHIVE IS NEW HERE AND IS THE POINT OF THE STRIP. It is the most-used
       * triage verb in any mail client and the open conversation had no way to
       * reach it: you closed the thread, found its row again, ticked its
       * checkbox and pressed the bulk Archive. It is hidden while reading the
       * Archive, where it is a no-op dressed as an action — the same rule
       * `ThreadList`'s BULK filter already applies.
       */}
      <header className="shrink-0 border-b border-border px-4 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">
              {thread.subject || tr("(no subject)")}
            </h2>
            <p className="num truncate text-xs text-muted-foreground">
              {(Array.isArray(thread.participants) ? thread.participants : []).join(", ")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {thread.entity_ref && (
              <span title={thread.entity_ref}>
                <Pill tone="blue">{thread.entity_label || thread.entity_ref}</Pill>
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={onClose} className="lg:hidden">
              {tr("Close")}
            </Button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => setReplying("REPLY")}>
            {tr("Reply")}
          </Button>
          {/* Offered only when there IS somebody else on it. A "Reply all"
              that produces the same message as "Reply" is a button that
              teaches people the two are interchangeable — and then they use
              it on the thread where they are not. */}
          {replyAllCc.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReplying("REPLY_ALL")}
              title={`${tr("Also copies")} ${replyAllCc.join(", ")}`}
            >
              {`${tr("Reply All")} (${replyAllCc.length + replyTo.length})`}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setReplying("FORWARD")}>
            {tr("Forward")}
          </Button>

          <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-border" />

          {folder !== "ARCHIVE" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onMove("ARCHIVE")}
            >
              {tr("Archive")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onToggleRead(thread.unread_count > 0)}
          >
            {thread.unread_count > 0 ? tr("Mark Read") : tr("Mark Unread")}
          </Button>

          {/* Everything a reader does once in a while, most-used first and the
              irreversible one last behind a separator — more-menu.tsx's own
              rule. The two `<select>`s became real menu items: a placeholder
              option is not a label, and "Move to…" announced as the control's
              value rather than its purpose. */}
          <MoreMenu label={tr("Conversation actions")} className="ml-auto" disabled={busy}>
            {MOVE_TO.filter((f) => f !== folder).map((f) => (
              <DropdownItem key={f} onSelect={() => onMove(f)}>
                {`${tr("Move to")} ${tr(f.charAt(0) + f.slice(1).toLowerCase())}`}
              </DropdownItem>
            ))}
            {labels.length > 0 && <DropdownSeparator />}
            {labels.map((l) => (
              <DropdownItem
                key={l.email_label_id}
                onSelect={() => onLabel(l.email_label_id)}
              >
                {`${tr("Label as")} ${l.name}`}
              </DropdownItem>
            ))}
            <DropdownSeparator />
            <DropdownItem
              onSelect={() => onStream(thread.stream === "SYSTEM" ? "HUMAN" : "SYSTEM")}
            >
              {thread.stream === "SYSTEM"
                ? tr("Reclassify as mail from a person")
                : tr("Reclassify as an automated notice")}
            </DropdownItem>
            {onDelete && (
              <>
                <DropdownSeparator />
                <DropdownItem destructive onSelect={onDelete}>
                  {tr("Delete for ever")}
                </DropdownItem>
              </>
            )}
          </MoreMenu>
        </div>

        {/* WHY the classifier put this here, in words. A verdict without a
            reason is one people learn to distrust, and the control that
            overrides it is one item down the `⋯` menu. */}
        {thread.stream === "SYSTEM" && thread.stream_reason && (
          <p className="mt-2 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            {tr("Filed as a notice:")} {thread.stream_reason}
          </p>
        )}
      </header>

      {/* The conversation and the work rail, side by side on a wide screen and
          stacked below one. The rail is second in the DOM so a keyboard or
          screen-reader user reaches the correspondence first — it is what they
          opened the thread for. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
        <div className="min-h-0 min-w-0 flex-1 space-y-2 overflow-y-auto p-3">
          {messages.map((m, i) => (
            <MessageBlock
              key={m.email_message_id}
              message={m}
              defaultOpen={i === lastIndex}
              repairedHtml={repaired[m.email_message_id]}
              palette={palette}
              trustedSenders={trustedSenders}
              onTrust={onTrust}
              onMailto={setMailto}
              onRepaired={onRepaired}
            />
          ))}
        </div>
        {railOpen ? (
          <div className="min-h-0 shrink-0 xl:w-[22rem]">
            <WorkRail
              thread={thread}
              onChanged={onWorkChanged || (() => {})}
              onCollapse={() => setRailOpen(false)}
            />
          </div>
        ) : (
          /* COLLAPSED: a full-height spine on wide screens, a plain bar when
             the layout has already stacked. Never nothing — a rail that can be
             hidden with no way back is a feature people lose, and the binding
             chip inside it is the most consequential control in the mailbox. */
          <div className="shrink-0 border-t border-border xl:border-l xl:border-t-0">
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              aria-expanded={false}
              aria-controls="mail-work-rail"
              title={tr("Show the work panel")}
              className="flex w-full items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground xl:h-full xl:w-11 xl:flex-col xl:py-4"
            >
              <span aria-hidden className="text-sm leading-none">‹</span>
              {/* Vertical on the desktop spine, horizontal in the stacked bar.
                  `writing-mode` rather than a rotate: a rotated element keeps
                  its original box, so the spine would reserve a full label's
                  width and the reading pane would not get the space back. */}
              <span className="xl:[writing-mode:vertical-rl]">{tr("Work panel")}</span>
              {/* Unread work is visible from the collapsed state. Hiding the
                  rail must not hide that the thread is unbound or overdue —
                  those are the two facts an operator is scanning for. */}
              {railBadge && (
                <span
                  className={cn(
                    "grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold",
                    railBadge.tone === "bad"
                      ? "bg-[rgb(var(--bad))] text-white"
                      : "bg-primary text-primary-foreground",
                  )}
                  title={railBadge.label}
                >
                  {railBadge.mark}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* The composer, when the reader opens it, and NOTHING when they have
          not. Lazily: TipTap and ProseMirror are ~150 kB gzipped and most of
          the time somebody is reading, not writing — see the isEditorPackage
          note in vite.config.ts.

          The Reply / Reply all / Forward row that used to live here has moved
          to the command strip at the top of the pane; see the note on it. An
          empty footer renders no border and takes no height, so the
          correspondence gets the space back. */}
      {/* A `mailto:` link inside a message, as Outlook and Gmail handle one:
          their own composer, from the mailbox this conversation is on. */}
      {mailto && (
        <NewMessageDialog
          open
          onClose={() => setMailto(null)}
          onSent={() => setMailto(null)}
          to={mailto.to}
          cc={mailto.cc}
          subject={mailto.subject}
          bodyText={mailto.body}
          connectionId={thread.email_connection_id}
        />
      )}

      {replying && (
        <footer className="shrink-0 border-t border-border px-4 py-3">
          <React.Suspense fallback={<LoadingRow label={tr("Opening the composer…")} />}>
            <Composer
              // Remounted when the mode changes, so switching from Reply to
              // Reply all actually re-seeds the recipients. `initialTo` is read
              // once, on mount — without the key, the second choice would open
              // the first choice's composer and quietly lose the Cc.
              key={replying}
              connectionId={thread.email_connection_id}
              threadId={thread.email_thread_id}
              replyToMessageId={messages[lastIndex]?.email_message_id || null}
              kind={replying}
              initialTo={replying === "FORWARD" ? [] : replyTo}
              initialCc={replying === "REPLY_ALL" ? replyAllCc : []}
              initialSubject={replying === "FORWARD" ? forwardSubject : replySubject}
              quotedHtml={
                (messages[lastIndex] && repaired[messages[lastIndex].email_message_id])
                || messages[lastIndex]?.body_html
                || null
              }
              quotedText={messages[lastIndex]?.body_text || null}
              entityRef={thread.entity_ref || null}
              onClose={() => setReplying(null)}
              onSent={onReplied}
              slots={{ "composer.footer.left": <SignatureSlot /> }}
            />
          </React.Suspense>
        </footer>
      )}
    </div>
  );
}
