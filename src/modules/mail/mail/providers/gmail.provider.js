/**
 * GmailProvider — Phase 2 adapter (native, axios; no googleapis dep). Same
 * EmailProvider contract as the others. Token is externalized via getAccessToken()
 * (mail.service refreshes + persists the vault bundle).
 *
 *   new GmailProvider({ getAccessToken, emailAddress })
 *
 * Gmail files sent mail itself → no appendSent. Threads are server-side
 * (threadId).
 *
 * ── LABELS ARE FOLDERS, AND ONE OF THEM IS NOT A LABEL ──────────────────────
 *
 * This adapter used to read the Inbox only, and the newest 25 messages of it on
 * a first sync, so a Gmail mailbox had no Sent, Drafts, Spam or Trash in the
 * rail and most of its inbox was missing. Gmail's system labels are now listed
 * as the standard folders, the user's own labels are recorded beside them, and
 * Archive is a VIRTUAL folder (ARCHIVE_PATH): Gmail has no archive label, it has
 * mail that is no longer in the inbox, and that is what Archive lists.
 *
 * A Gmail message carries many labels and a Praxis message sits in one folder,
 * so `folderOf` picks one, in the order a person would: Trash, Spam and Drafts
 * first because each means "not here", then Inbox, then Sent, and anything else
 * is archived.
 *
 * ── ONE HISTORY, CARRIED BY THE INBOX ───────────────────────────────────────
 *
 * Gmail's history is one stream for the whole mailbox. Running it once per
 * folder would fetch every change six times, so the INBOX folder's cursor
 * carries it: each sync reads what changed anywhere since the last one, works
 * out where each changed message lives now, and hands it back with that folder
 * on it. The other folders only read their own history once, on their first
 * sync, in resumable pages (`page_token`), and after that have nothing to do.
 *
 * The inbox's own first read is paged the same way, and the history catch-up
 * runs before it on every sync, so mail that arrives during a long first read
 * appears straight away rather than when the backfill finishes.
 */
"use strict";

const axios = require("axios");
const { baseCapabilities } = require("./provider.interface");
const { logger } = require("../../../../config/logger");

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const ATTACH_MAX_BYTES = 25 * 1024 * 1024;

/** The folder that is not a label: everything no longer in the inbox. */
const ARCHIVE_PATH = "praxis:archive";
const ARCHIVE_QUERY = "-in:inbox -in:sent -in:draft -in:spam -in:trash -in:chats";
/** Messages per listing page, and listing pages per folder per sync. */
const PAGE_SIZE = 100;
const PAGES_PER_RUN = 3;
/** History pages per sync; the cursor moves to the last record read. */
const HISTORY_PAGES = 20;
/** See `fetchSince`. A cursor without it was written by the inbox-only adapter. */
const CURSOR_V = 2;
const HISTORY_TYPES = ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"];

/** Gmail's system labels, as the RFC 6154 flag `folders.js` reads. */
const SYSTEM_FOLDERS = {
  INBOX: { flag: "\\inbox", name: "Inbox" },
  SENT: { flag: "\\sent", name: "Sent" },
  DRAFT: { flag: "\\drafts", name: "Drafts" },
  SPAM: { flag: "\\junk", name: "Spam" },
  TRASH: { flag: "\\trash", name: "Trash" },
};

/**
 * Where a message lives, from its labels: the canonical folder and the path
 * (label id) that put it there. See LABELS ARE FOLDERS above for the order.
 */
function folderOf(labelIds = []) {
  const has = (l) => labelIds.includes(l);
  if (has("TRASH")) return { folder: "TRASH", path: "TRASH" };
  if (has("SPAM")) return { folder: "SPAM", path: "SPAM" };
  if (has("DRAFT")) return { folder: "DRAFTS", path: "DRAFT" };
  if (has("INBOX")) return { folder: "INBOX", path: "INBOX" };
  if (has("SENT")) return { folder: "SENT", path: "SENT" };
  const own = labelIds.find((l) => /^Label_/.test(String(l)));
  return { folder: "ARCHIVE", path: own || ARCHIVE_PATH };
}

const status = (err) => (err && err.response ? err.response.status : null);

/** `"Angela Lau" <angela@x>` → `Angela Lau`; a bare address has no name. */
function displayNameOf(header) {
  const m = /^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/.exec(String(header || ""));
  const name = m ? m[1].trim() : "";
  return name && !name.includes("@") ? name : null;
}

const b64urlDecode = (data) => Buffer.from(String(data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
const b64urlEncode = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const emailsIn = (s) => (String(s || "").match(/[^\s<>@,]+@[^\s<>@,]+/g) || []);

class GmailProvider {
  constructor({ getAccessToken, emailAddress } = {}) {
    if (typeof getAccessToken !== "function") throw new Error("GmailProvider needs getAccessToken()");
    this._getToken = getAccessToken;
    this.emailAddress = emailAddress;
    this.provider = "google_gmail";
  }

  /**
   * `serverDelete` is a move to Trash, not an expunge: the `gmail.modify` scope
   * this app asks for cannot delete for good, and asking for full mail access
   * to save Gmail thirty days of keeping it is the wrong trade. Gmail empties
   * Trash itself.
   */
  capabilities() {
    return {
      ...baseCapabilities(),
      push: false, delta: true, serverThreads: true, appendSent: false,
      folders: true, folderMove: true, serverFlags: true, serverDelete: true,
    };
  }

  async _req(method, path, { data, params } = {}) {
    const token = await this._getToken();
    const url = path.startsWith("http") ? path : BASE + path;
    // `indexes: null` sends an array as `historyTypes=a&historyTypes=b`, which
    // is what Google reads. axios's default is `historyTypes[]=a`, which it
    // does not, so a list parameter was silently dropped.
    return axios({
      method, url, params, data, paramsSerializer: { indexes: null },
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  }

  async verify() {
    try {
      const r = await this._req("GET", "/profile");
      return { ok: true, email: r.data.emailAddress, historyId: r.data.historyId };
    } catch (err) {
      return { ok: false, error: gmailError(err) };
    }
  }

  async _composeRaw(mail) {
     
    const nodemailer = require("nodemailer");
    const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "\r\n" });
    const info = await composer.sendMail(mail);
    return b64urlEncode(info.message);
  }

  async sendEmail(msg) {
    const raw = await this._composeRaw({
      from: msg.from || this.emailAddress, to: msg.to, cc: msg.cc, subject: msg.subject,
      html: msg.bodyHtml || undefined, text: msg.bodyText || undefined,
      inReplyTo: msg.inReplyTo, references: msg.references,
      // The Message-ID and X-Praxis stamp the engine chose. Without them the
      // copy Gmail files in Sent carried a Message-ID nobody had recorded, and
      // a message sent from Praxis read on the next sync as one sent elsewhere.
      messageId: msg.messageId || undefined,
      headers: msg.headers || undefined,
    });
    const body = { raw };
    if (msg.threadId) body.threadId = msg.threadId;
    const r = await this._req("POST", "/messages/send", { data: body });
    return { externalMessageId: r.data.id, threadKey: r.data.threadId };
  }

  /** Reply in-thread: fetch the original's RFC Message-ID + threadId, then send a
   *  raw message with In-Reply-To/References set and the same threadId. */
  async createReply(externalMessageId, msg) {
    const meta = await this._req("GET", `/messages/${externalMessageId}`, {
      params: { format: "metadata", metadataHeaders: ["Message-ID", "Subject", "From", "References"] },
    });
    const headers = (meta.data.payload && meta.data.payload.headers) || [];
    const h = (n) => { const f = headers.find((x) => x.name.toLowerCase() === n.toLowerCase()); return f ? f.value : null; };
    const origMsgId = h("Message-ID");
    const refs = [h("References"), origMsgId].filter(Boolean).join(" ").trim();
    return this.sendEmail({
      ...msg,
      to: msg.to || emailsIn(h("From"))[0],
      subject: msg.subject,
      inReplyTo: origMsgId || undefined,
      references: refs ? refs.split(/\s+/) : undefined,
      threadId: meta.data.threadId,
    });
  }

  /**
   * The mailbox's labels as folders, in the shape `folders.mapFolders` reads:
   * the five system labels that are folders, the user's own labels, and the
   * virtual Archive.
   */
  async listFolders() {
    const r = await this._req("GET", "/labels");
    const out = [];
    for (const l of r.data.labels || []) {
      if (!l || !l.id) continue;
      const sys = SYSTEM_FOLDERS[l.id];
      if (sys) out.push({ path: l.id, name: sys.name, displayName: sys.name, flags: [sys.flag] });
      else if (l.type === "user") out.push({ path: l.id, name: l.name, displayName: l.name, flags: [] });
    }
    out.push({ path: ARCHIVE_PATH, name: "Archive", displayName: "Archive", flags: ["\\archive"] });
    return out;
  }

  /**
   * One folder's share of a sync.
   *
   *   cursor = { v: 2, history_id, page_token, backfill }
   *
   * `history_id` is where the mailbox-wide history resumes (INBOX only; see ONE
   * HISTORY above). It is taken from the profile BEFORE a first read starts,
   * so nothing that changes during the read is missed. `page_token` and
   * `backfill` are the first read's place, until it is finished.
   *
   * Each message comes back with `folder` and `providerPath` set from its
   * labels, because the history hands back mail from every folder at once.
   * `removed` lists the messages Gmail has deleted for good.
   */
  async fetchSince(cursor, folderPath) {
    const path = folderPath || "INBOX";
    const prior = cursor && Number(cursor.v) === CURSOR_V ? cursor : null;
    const next = prior
      ? { ...prior }
      : { v: CURSOR_V, history_id: String((await this._req("GET", "/profile")).data.historyId), page_token: null, backfill: true };
    const ids = new Set();
    const removed = [];

    if (path === "INBOX" && prior && prior.history_id) {
      try {
        const h = await this._history(prior.history_id);
        h.added.forEach((id) => ids.add(id));
        removed.push(...h.removed);
        next.history_id = h.historyId;
      } catch (err) {
        // 404: the stored historyId aged out of Gmail's window. Read the inbox
        // again from the top; the engine's dedup absorbs what it already has.
        if (status(err) !== 404) throw err;
        next.history_id = String((await this._req("GET", "/profile")).data.historyId);
        next.page_token = null;
        next.backfill = true;
      }
    }

    if (next.backfill) {
      let pageToken = next.page_token || undefined;
      let done = false;
      for (let page = 0; page < PAGES_PER_RUN; page += 1) {
        const params = path === ARCHIVE_PATH
          ? { q: ARCHIVE_QUERY, maxResults: PAGE_SIZE, pageToken }
          : { labelIds: path, maxResults: PAGE_SIZE, pageToken, includeSpamTrash: path === "SPAM" || path === "TRASH" };
        const list = await this._req("GET", "/messages", { params });
        for (const m of list.data.messages || []) ids.add(m.id);
        pageToken = list.data.nextPageToken || undefined;
        if (!pageToken) { done = true; break; }
      }
      next.page_token = done ? null : pageToken;
      next.backfill = !done;
    }

    const messages = (await this._getMany([...ids])).filter((m) => !m.isChat);
    return { messages, removed, nextCursor: next, more: next.backfill };
  }

  /**
   * Every message that changed since `startHistoryId`, anywhere in the mailbox.
   * Bounded per sync; the cursor moves to the last record read, so a backlog
   * larger than one sync is finished by the next.
   */
  async _history(startHistoryId) {
    const added = new Set();
    const removed = [];
    let historyId = String(startHistoryId);
    let pageToken;
    for (let page = 0; page < HISTORY_PAGES; page += 1) {
      const r = await this._req("GET", "/history", {
        params: { startHistoryId, historyTypes: HISTORY_TYPES, pageToken },
      });
      for (const rec of r.data.history || []) {
        for (const x of [...(rec.messagesAdded || []), ...(rec.labelsAdded || []), ...(rec.labelsRemoved || [])]) {
          if (x.message && x.message.id) added.add(x.message.id);
        }
        for (const x of rec.messagesDeleted || []) {
          if (x.message && x.message.id) { added.delete(x.message.id); removed.push({ externalMessageId: x.message.id, fromPath: null }); }
        }
        if (rec.id) historyId = String(rec.id);
      }
      pageToken = r.data.nextPageToken;
      if (!pageToken) { if (r.data.historyId) historyId = String(r.data.historyId); break; }
    }
    return { added: [...added], removed, historyId };
  }

  /** Where a message is now, from its labels; null when Gmail no longer has it. */
  async locateMessage(externalMessageId) {
    try {
      const r = await this._req("GET", `/messages/${externalMessageId}`, { params: { format: "minimal" } });
      return { path: folderOf(r.data.labelIds || []).path };
    } catch (err) {
      if (status(err) === 404) return null;
      throw err;
    }
  }

  /**
   * File a message in another folder, the way Gmail's own "Move to" does it.
   * Sent and Drafts are Gmail's to decide and cannot be added from outside.
   */
  async moveMessage(externalMessageId, destinationPath, fromPath) {
    const id = externalMessageId;
    if (destinationPath === "SENT" || destinationPath === "DRAFT") return { moved: false };
    if (destinationPath === "TRASH") {
      await this._req("POST", `/messages/${id}/trash`);
      return { moved: true };
    }
    if (fromPath === "TRASH") await this._req("POST", `/messages/${id}/untrash`);
    const modify = (addLabelIds, removeLabelIds) =>
      this._req("POST", `/messages/${id}/modify`, { data: { addLabelIds, removeLabelIds } });
    if (destinationPath === "SPAM") await modify(["SPAM"], ["INBOX"]);
    else if (destinationPath === "INBOX") await modify(["INBOX"], ["SPAM"]);
    else if (destinationPath === ARCHIVE_PATH) await modify([], ["INBOX", "SPAM"]);
    else await modify([destinationPath], ["INBOX", "SPAM"]);
    return { moved: true };
  }

  /** To Trash; see `capabilities`. A message already gone is a success. */
  async deleteMessage(externalMessageId) {
    try {
      await this._req("POST", `/messages/${externalMessageId}/trash`);
      return { deleted: true, trashed: true };
    } catch (err) {
      if (status(err) === 404) return { deleted: false };
      throw err;
    }
  }

  /**
   * Full messages for these ids. One deleted between the listing and the read
   * (a history entry can outlive its message) is skipped, not fatal: it used to
   * fail the whole folder for one message nobody could open any more.
   */
  async _getMany(ids) {
    const out = [];
    for (const id of ids) {
      try {
        const m = await this.getMessage(id);
        if (m) out.push(m);
      } catch (err) {
        if (status(err) !== 404) throw err;
      }
    }
    return out;
  }

  async getMessage(externalMessageId) {
    const r = await this._req("GET", `/messages/${externalMessageId}`, { params: { format: "full" } });
    const n = this._normalize(r.data);
    if (n.attachments.length) n.attachments = await this._hydrateAttachments(externalMessageId, n.attachments);
    return n;
  }

  /**
   * The message as Gmail holds it (RFC 822), for View source / Download
   * original. `format=raw` is the whole MIME tree, base64url-encoded. A Gmail
   * id is stable across labels, so no folder is needed.
   */
  async getRawMessage(externalMessageId) {
    const r = await this._req("GET", `/messages/${externalMessageId}`, { params: { format: "raw" } });
    return r.data && r.data.raw ? b64urlDecode(r.data.raw) : null;
  }

  /** Download attachment bytes for the refs collected in _normalize. */
  async _hydrateAttachments(messageId, refs) {
    const out = [];
    for (const a of refs) {
      if (!a.attachmentId) continue;
      try {
         
        const r = await this._req("GET", `/messages/${messageId}/attachments/${a.attachmentId}`);
        const content = b64urlDecode(r.data.data);
        if (content.length <= ATTACH_MAX_BYTES) {
          out.push({
            filename: a.filename, content_type: a.content_type, size_bytes: content.length, content,
            content_id: a.content_id || null, disposition: a.disposition || "attachment",
          });
        }
      } catch (err) {
        // One part that will not download must not cost the message. Logged,
        // not swallowed: an inline image skipped here is a broken picture in
        // the reading pane, and this line is the only trace of why.
        logger.warn({ err: gmailError(err), message: messageId, part: a.attachmentId }, "[mail] gmail attachment skipped");
      }
    }
    return out;
  }

  async markAsRead(externalMessageId) {
    await this._req("POST", `/messages/${externalMessageId}/modify`, { data: { removeLabelIds: ["UNREAD"] } });
  }

  /**
   * Gmail push: register a Cloud Pub/Sub watch. Must be renewed weekly. No
   * label filter, so a change in any folder wakes the sync; it watched the
   * Inbox only while the Inbox was all this adapter read.
   */
  async watch({ topicName }) {
    const r = await this._req("POST", "/watch", { data: { topicName } });
    return { subscriptionId: topicName, expiresAt: r.data.expiration ? new Date(Number(r.data.expiration)) : null, historyId: r.data.historyId };
  }

  /** Renew = re-issue the watch on the same topic. */
  async renewSubscription(subscriptionId) {
    const w = await this.watch({ topicName: subscriptionId });
    return { expiresAt: w.expiresAt };
  }

  /** Gmail message resource (format=full) → NormalizedEmail. */
  _normalize(m) {
    const payload = m.payload || {};
    const headers = payload.headers || [];
    const h = (n) => { const f = headers.find((x) => x.name.toLowerCase() === n.toLowerCase()); return f ? f.value : null; };
    let bodyText = null;
    let bodyHtml = null;
    const attachments = [];
    const walk = (part) => {
      if (!part) return;
      const mime = part.mimeType || "";
      // An inline image is a part with a Content-ID, and Gmail often sends one
      // with no filename at all. Requiring a filename dropped exactly those, so
      // the `cid:` in the HTML pointed at a part that was never stored.
      const ph = (n) => {
        const f = (part.headers || []).find((x) => String(x.name).toLowerCase() === n);
        return f ? String(f.value) : "";
      };
      const contentId = ph("content-id").trim().replace(/^<|>$/g, "") || null;
      if ((part.filename || contentId) && part.body && part.body.attachmentId) {
        attachments.push({
          filename: part.filename || contentId, content_type: mime || "application/octet-stream",
          size_bytes: part.body.size, attachmentId: part.body.attachmentId,
          content_id: contentId,
          disposition: /^\s*inline/i.test(ph("content-disposition")) || (contentId && !/^\s*attachment/i.test(ph("content-disposition")))
            ? "inline" : "attachment",
        });
      } else if (mime === "text/plain" && part.body && part.body.data) bodyText = b64urlDecode(part.body.data).toString("utf8");
      else if (mime === "text/html" && part.body && part.body.data) bodyHtml = b64urlDecode(part.body.data).toString("utf8");
      (part.parts || []).forEach(walk);
    };
    walk(payload);
    if (!bodyText && !bodyHtml && payload.body && payload.body.data) {
      const decoded = b64urlDecode(payload.body.data).toString("utf8");
      if ((payload.mimeType || "").includes("html")) bodyHtml = decoded; else bodyText = decoded;
    }
    const labels = m.labelIds || [];
    const where = folderOf(labels);
    return {
      externalMessageId: m.id,
      threadKey: m.threadId,
      // The engine decides direction from the folder (Sent and Drafts are ours).
      direction: "IN",
      from: emailsIn(h("From"))[0] || null,
      fromName: displayNameOf(h("From")),
      to: emailsIn(h("To")),
      cc: emailsIn(h("Cc")),
      subject: h("Subject"),
      bodyHtml,
      bodyText: bodyText || m.snippet || null,
      attachments, // refs (attachmentId) — hydrated to bytes in getMessage
      inReplyTo: h("In-Reply-To"),
      references: (h("References") || "").split(/\s+/).filter(Boolean),
      receivedAt: m.internalDate ? new Date(Number(m.internalDate)) : new Date(),
      isRead: !labels.includes("UNREAD"),
      messageIdHeader: h("Message-ID"),
      headers,
      // Where it lives now; see LABELS ARE FOLDERS.
      folder: where.folder,
      providerPath: where.path,
      // Hangouts and Chat transcripts carry the CHAT label and are not mail.
      isChat: labels.includes("CHAT"),
      provider: "google_gmail",
    };
  }
}

function gmailError(err) {
  const d = err && err.response && err.response.data;
  if (d && d.error && d.error.message) return d.error.message;
  return err && err.message ? err.message : "gmail request failed";
}

module.exports = { GmailProvider, gmailError, folderOf, ARCHIVE_PATH, CURSOR_V };
