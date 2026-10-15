/**
 * MicrosoftGraphProvider — Phase 2 adapter (native, axios; no SDK dep). Implements
 * the same EmailProvider contract as ImapSmtpProvider so the engine is unchanged.
 *
 * Token handling is EXTERNALIZED: the constructor takes `getAccessToken()`, an
 * async fn the service supplies that returns a currently-valid bearer token
 * (refreshing + persisting the vault bundle as needed). The adapter never sees the
 * refresh token or client secret — it just asks for a fresh access token per call.
 *
 *   new MicrosoftGraphProvider({ getAccessToken })
 *
 * Capabilities: push + delta + server-side threads, folders, moves, read state
 * and deletes; Graph files Sent itself, so NO appendSent (unlike SMTP).
 *
 * ── EVERY FOLDER, NOT ONLY THE INBOX ────────────────────────────────────────
 *
 * This adapter used to read `/mailFolders/inbox` and nothing else, and had no
 * `listFolders`, so the engine recorded one folder for a Microsoft mailbox and
 * the rail had no Sent, Drafts, Junk, Archive or Deleted Items to draw. The same
 * account connected over IMAP showed all of them, which is how it was noticed.
 * Folders are now listed the way IMAP lists them: the six standard ones by
 * Microsoft's own well-known names (language-independent, so "Éléments envoyés"
 * is Sent), the user's own folders recorded beside them, and each synced folder
 * read through its own delta cursor.
 *
 * ── IMMUTABLE IDS ───────────────────────────────────────────────────────────
 *
 * A Graph message id CHANGES when the message changes folder, unless the call
 * asks for `Prefer: IdType="ImmutableId"`. With a folder-by-folder sync that
 * matters twice: a message archived in Outlook would arrive in Archive under a
 * new id and be stored a second time, and the copy of a message sent from
 * Praxis would never match its own row. Every request asks for immutable ids,
 * and `translateIds` moves ids stored before this change (see 14420).
 *
 * ── RESUMABLE ───────────────────────────────────────────────────────────────
 *
 * A first sync reads a whole folder, which on a real mailbox is tens of
 * thousands of messages. One sync reads at most PAGES_PER_RUN pages of a folder
 * and stores the page link it stopped at; the next sync carries on from there.
 * The old loop stopped after 50 pages with no link to resume from, and the next
 * sync started the folder again from the top, forever.
 */
"use strict";

const axios = require("axios");
const { baseCapabilities } = require("./provider.interface");
const { logger } = require("../../../../config/logger");

const GRAPH = "https://graph.microsoft.com/v1.0";
const SELECT = "id,internetMessageId,conversationId,parentFolderId,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,isDraft,hasAttachments,body,bodyPreview";
const ATTACH_MAX_BYTES = 25 * 1024 * 1024;

/** Asked on every request; see IMMUTABLE IDS above. */
const IMMUTABLE = 'IdType="ImmutableId"';
/** Messages per delta page, and pages per folder per sync (see RESUMABLE). */
const PAGE_SIZE = 50;
const PAGES_PER_RUN = 10;
/**
 * The shape of a folder cursor. A cursor without it was written by the
 * inbox-only adapter, against mutable ids, and is not resumed: the folder is
 * read again from the top, and the engine's dedup absorbs what it already has.
 */
const CURSOR_V = 2;
/** What the subscription watches: every message, in every folder. */
const SUBSCRIPTION_RESOURCE = "me/messages";
/** translateExchangeIds takes at most this many per call. */
const TRANSLATE_MAX = 1000;

/**
 * Microsoft's well-known folder names, as the RFC 6154 flag `folders.js` reads.
 * Named rather than matched on display name, which is in the mailbox's language.
 */
const WELL_KNOWN = {
  inbox: "\\inbox",
  sentitems: "\\sent",
  drafts: "\\drafts",
  junkemail: "\\junk",
  archive: "\\archive",
  deleteditems: "\\trash",
};
/**
 * Top-level folders that hold no mail a person reads here: Exchange's own
 * Outbox (Praxis has its own), Teams conversation history, and sync conflicts.
 */
const NOT_MAIL = ["outbox", "conversationhistory", "syncissues"];

const status = (err) => (err && err.response ? err.response.status : null);
const graphCode = (err) => {
  const d = err && err.response && err.response.data;
  return d && d.error && d.error.code ? String(d.error.code) : "";
};
/** Graph has dropped this delta's position; the only answer is to read the folder again. */
const isResync = (err) => status(err) === 410 || /syncstate|resyncrequired/i.test(graphCode(err));

class MicrosoftGraphProvider {
  constructor({ getAccessToken } = {}) {
    if (typeof getAccessToken !== "function") throw new Error("MicrosoftGraphProvider needs getAccessToken()");
    this._getToken = getAccessToken;
    this.provider = "microsoft_graph";
  }

  capabilities() {
    return {
      ...baseCapabilities(),
      push: true, delta: true, serverThreads: true, appendSent: false,
      folders: true, folderMove: true, serverFlags: true, serverDelete: true,
    };
  }

  async _req(method, url, { data, params, responseType, prefer } = {}) {
    const token = await this._getToken();
    const full = url.startsWith("http") ? url : GRAPH + url;
    return axios({
      method, url: full, params, data, responseType,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: [IMMUTABLE, prefer].filter(Boolean).join(", "),
      },
    });
  }

  async verify() {
    try {
      const r = await this._req("GET", "/me?$select=mail,userPrincipalName");
      return { ok: true, email: r.data.mail || r.data.userPrincipalName };
    } catch (err) {
      return { ok: false, error: graphError(err) };
    }
  }

  _draftBody(msg) {
    const recipients = (list) => (list || []).filter(Boolean).map((a) => ({ emailAddress: { address: a } }));
    const to = Array.isArray(msg.to) ? msg.to : [msg.to];
    return {
      subject: msg.subject,
      body: { contentType: msg.bodyHtml ? "HTML" : "Text", content: msg.bodyHtml || msg.bodyText || "" },
      toRecipients: recipients(to),
      ccRecipients: recipients(msg.cc),
    };
  }

  /** Create a draft (so we capture id + conversationId), then send it. */
  async sendEmail(msg) {
    const created = await this._req("POST", "/me/messages", { data: this._draftBody(msg) });
    const { id, conversationId } = created.data;
    await this._req("POST", `/me/messages/${id}/send`);
    return { externalMessageId: id, threadKey: conversationId };
  }

  /** Reply in-thread: Graph createReply → draft, patch our body, send. */
  async createReply(externalMessageId, msg) {
    const draft = await this._req("POST", `/me/messages/${externalMessageId}/createReply`);
    const id = draft.data.id;
    await this._req("PATCH", `/me/messages/${id}`, {
      data: { body: { contentType: msg.bodyHtml ? "HTML" : "Text", content: msg.bodyHtml || msg.bodyText || "" } },
    });
    await this._req("POST", `/me/messages/${id}/send`);
    return { externalMessageId: id, threadKey: draft.data.conversationId };
  }

  /**
   * The mailbox's folders, in the shape `folders.mapFolders` reads.
   *
   * The well-known folders are looked up by name in one `$batch`, because only
   * the name says which folder is Sent in a mailbox whose display names are in
   * French. A mailbox with no Archive folder answers 404 for that one request,
   * which is simply a folder it does not have. The user's own top-level folders
   * are listed beside them; the engine records them and syncs only the six.
   */
  async listFolders() {
    const names = [...Object.keys(WELL_KNOWN), ...NOT_MAIL];
    const batch = await this._req("POST", "/$batch", {
      data: {
        requests: names.map((name, i) => ({
          id: String(i), method: "GET",
          url: `/me/mailFolders/${name}?$select=id,displayName`,
          headers: { Prefer: IMMUTABLE },
        })),
      },
    });
    const flagById = new Map();
    const skip = new Set();
    const known = [];
    for (const r of (batch.data && batch.data.responses) || []) {
      const name = names[Number(r.id)];
      if (Number(r.status) !== 200 || !r.body || !r.body.id) continue;
      if (WELL_KNOWN[name]) {
        flagById.set(r.body.id, WELL_KNOWN[name]);
        known.push({ path: r.body.id, name: r.body.displayName, displayName: r.body.displayName, flags: [WELL_KNOWN[name]] });
      } else {
        skip.add(r.body.id);
      }
    }

    const out = [...known];
    let url = "/me/mailFolders?$top=100&$select=id,displayName";
    for (let i = 0; url && i < 5; i += 1) {
      const r = await this._req("GET", url);
      for (const f of r.data.value || []) {
        if (!f || !f.id || skip.has(f.id) || flagById.has(f.id)) continue;
        out.push({ path: f.id, name: f.displayName, displayName: f.displayName, flags: [] });
      }
      url = r.data["@odata.nextLink"] || null;
    }
    return out;
  }

  /**
   * Delta sync of ONE folder.
   *
   *   cursor = { v: 2, delta_link }             the folder is in step
   *   cursor = { v: 2, next_link, delta_link }  a first read stopped part way
   *
   * Follows `@odata.nextLink` for up to PAGES_PER_RUN pages and stores where it
   * stopped; the final page's `@odata.deltaLink` is the cursor from then on.
   * Delta is quota-friendly and gap-free (Graph tracks state), so the timestamp
   * trap that bites IMAP does not apply.
   *
   * `removed` is every message Graph says has LEFT this folder: moved elsewhere
   * or deleted, and it does not say which. The engine asks `locateMessage`
   * about the ones no other folder has claimed by the end of the sync.
   *
   * A 410, or a sync-state error, means Graph has forgotten this position. The
   * folder is read again from the top once, in the same call.
   */
  async fetchSince(cursor, folderPath) {
    const folder = folderPath || "inbox";
    const fresh = `/me/mailFolders/${encodeURIComponent(folder)}/messages/delta?$select=${SELECT}`;
    const prior = cursor && Number(cursor.v) === CURSOR_V ? cursor : null;
    let url = (prior && (prior.next_link || prior.delta_link)) || fresh;
    let deltaLink = prior ? prior.delta_link || null : null;
    let startedAt = (prior && prior.started_at) || new Date().toISOString();
    let restarted = false;
    const messages = [];
    const removed = [];

    // A first read that is still going: a delta round reports nothing new until
    // it has walked the whole folder, which on a big mailbox is hours. So the
    // mail that arrived since it started is read directly, newest first, and the
    // dedup absorbs it when the walk reaches it.
    if (prior && prior.next_link && !prior.delta_link) {
      const since = new Date(Date.parse(startedAt) - 10 * 60 * 1000).toISOString();
      // Spelled out rather than handed to axios, which encodes a space in a
      // query value as `+`; OData reads `%20`.
      const query = [
        `$select=${SELECT}`,
        `$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}`,
        `$orderby=${encodeURIComponent("receivedDateTime desc")}`,
        `$top=${PAGE_SIZE}`,
      ].join("&");
      const r = await this._req("GET", `/me/mailFolders/${encodeURIComponent(folder)}/messages?${query}`);
      for (const m of r.data.value || []) messages.push(await this._hydrate(m));
    }

    for (let page = 0; page < PAGES_PER_RUN; page += 1) {
      let r;
      try {
        r = await this._req("GET", url, { prefer: `odata.maxpagesize=${PAGE_SIZE}` });
      } catch (err) {
        if (restarted || !isResync(err)) throw err;
        restarted = true;
        url = fresh;
        deltaLink = null;
        startedAt = new Date().toISOString();
        page = -1;
        continue;
      }
      for (const m of r.data.value || []) {
        if (m["@removed"]) {
          if (m.id) removed.push({ externalMessageId: m.id, fromPath: folder });
          continue;
        }
        messages.push(await this._hydrate(m));
      }
      if (r.data["@odata.nextLink"]) { url = r.data["@odata.nextLink"]; continue; }
      return { messages, removed, nextCursor: { v: CURSOR_V, delta_link: r.data["@odata.deltaLink"] || deltaLink } };
    }
    // Out of pages for this sync, mid-folder: carry on from here next time.
    // `backfill` while no round has finished yet: the engine reads it as "this
    // folder is still on its first read" (see `isFirstSync` in mail.service).
    return {
      messages, removed, more: true,
      nextCursor: { v: CURSOR_V, next_link: url, delta_link: deltaLink, started_at: startedAt, backfill: !deltaLink },
    };
  }

  async _hydrate(m) {
    const n = this._normalize(m);
    if (m.hasAttachments) n.attachments = await this._fetchAttachments(m.id);
    return n;
  }

  /**
   * Where a message is now: `{ path }` (its folder id), or null when the
   * mailbox no longer has it at all. Asked only about a message that left a
   * synced folder and did not turn up in another one.
   */
  async locateMessage(externalMessageId) {
    try {
      const r = await this._req("GET", `/me/messages/${encodeURIComponent(externalMessageId)}?$select=id,parentFolderId`);
      return r.data && r.data.parentFolderId ? { path: r.data.parentFolderId } : null;
    } catch (err) {
      if (status(err) === 404) return null;
      throw err;
    }
  }

  /**
   * Stored (mutable) ids → immutable ids, for the one-time move in 14420.
   * Returns a Map of the ids Graph translated; an id it could not translate (a
   * message deleted since) is simply absent, and keeps its old value.
   */
  async translateIds(ids = []) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += TRANSLATE_MAX) {
      const chunk = ids.slice(i, i + TRANSLATE_MAX);
      const r = await this._req("POST", "/me/translateExchangeIds", {
        data: { inputIds: chunk, sourceIdType: "restId", targetIdType: "restImmutableEntryId" },
      });
      for (const t of (r.data && r.data.value) || []) {
        if (t && t.sourceId && t.targetId) out.set(t.sourceId, t.targetId);
      }
    }
    return out;
  }

  /**
   * Move to another folder. With immutable ids the message keeps its id, and
   * the one Graph returns is handed back so a row stored under an old id can
   * follow it.
   */
  async moveMessage(externalMessageId, destinationPath) {
    const r = await this._req("POST", `/me/messages/${encodeURIComponent(externalMessageId)}/move`, {
      data: { destinationId: destinationPath },
    });
    return { moved: true, externalMessageId: (r.data && r.data.id) || externalMessageId };
  }

  /**
   * Delete for good, like IMAP's expunge: a delete in Praxis is the second
   * delete (the first moved the conversation to Deleted Items), so it must not
   * leave the message in Recoverable Items to come back. A message already gone
   * is a success, for the reason given on the IMAP adapter.
   */
  async deleteMessage(externalMessageId) {
    try {
      await this._req("POST", `/me/messages/${encodeURIComponent(externalMessageId)}/permanentDelete`);
      return { deleted: true };
    } catch (err) {
      if (status(err) === 404) return { deleted: false };
      throw err;
    }
  }

  async getMessage(externalMessageId) {
    const r = await this._req("GET", `/me/messages/${externalMessageId}?$select=${SELECT}`);
    return this._hydrate(r.data);
  }

  /**
   * The message as Exchange holds it (RFC 822), for View source / Download
   * original. `$value` on a message is its MIME content; asked for as bytes so
   * axios does not try to read a mail as JSON.
   */
  async getRawMessage(externalMessageId) {
    const r = await this._req("GET", `/me/messages/${externalMessageId}/$value`, { responseType: "arraybuffer" });
    return r.data ? Buffer.from(r.data) : null;
  }

  /** Fetch file attachments (contentBytes) for a message. Item/reference
   *  attachments are skipped (no inline bytes). Oversized ones are dropped. */
  async _fetchAttachments(graphId) {
    try {
      const r = await this._req("GET", `/me/messages/${graphId}/attachments`);
      return (r.data.value || [])
        .filter((a) => a["@odata.type"] === "#microsoft.graph.fileAttachment" && a.contentBytes)
        // `isInline` + `contentId` are what the `cid:` in the HTML resolves
        // against. Without them the signature logo was stored as an ordinary
        // attachment and drawn as a broken image where the sender put it.
        .map((a) => ({
          filename: a.name, content_type: a.contentType || "application/octet-stream", size_bytes: a.size,
          content: Buffer.from(a.contentBytes, "base64"),
          content_id: String(a.contentId || "").trim().replace(/^<|>$/g, "") || null,
          disposition: a.isInline ? "inline" : "attachment",
        }))
        .filter((a) => a.content.length <= ATTACH_MAX_BYTES);
    } catch {
      return [];
    }
  }

  async markAsRead(externalMessageId) {
    await this._req("PATCH", `/me/messages/${externalMessageId}`, { data: { isRead: true } });
  }

  /**
   * Create a change subscription (webhook). notificationUrl must be publicly
   * reachable. Every message in the mailbox, so new Sent, Junk or Archive mail
   * syncs on arrival rather than at the next poll; it used to watch the Inbox
   * only. `updated` and `deleted` are what make a move or a delete made in
   * Outlook show up in Praxis without waiting.
   */
  async subscribe({ notificationUrl, clientState } = {}) {
    const expiration = new Date(Date.now() + 2.7 * 24 * 3600 * 1000).toISOString(); // < Graph's ~3d max
    const r = await this._req("POST", "/subscriptions", {
      data: {
        changeType: "created,updated,deleted",
        notificationUrl,
        resource: SUBSCRIPTION_RESOURCE,
        expirationDateTime: expiration,
        clientState,
      },
    });
    return { subscriptionId: r.data.id, expiresAt: r.data.expirationDateTime };
  }

  /**
   * Extend a subscription, or replace one made before every folder synced.
   * A subscription's resource cannot be changed, so an Inbox-only one is
   * swapped for a new one on the same notification URL; the caller stores the
   * new id it gets back.
   */
  async renewSubscription(subscriptionId, { clientState } = {}) {
    const expiration = new Date(Date.now() + 2.7 * 24 * 3600 * 1000).toISOString();
    let current = null;
    try {
      current = (await this._req("GET", `/subscriptions/${subscriptionId}`)).data;
    } catch (err) {
      if (status(err) !== 404) throw err;
    }
    if (current && String(current.resource || "").toLowerCase() !== SUBSCRIPTION_RESOURCE && current.notificationUrl) {
      const next = await this.subscribe({ notificationUrl: current.notificationUrl, clientState });
      try {
        await this._req("DELETE", `/subscriptions/${subscriptionId}`);
      } catch (err) {
        // It expires on its own within three days; the new one is what counts.
        logger.warn({ err: graphError(err), subscription: subscriptionId }, "[mail] old graph subscription not removed");
      }
      return next;
    }
    const r = await this._req("PATCH", `/subscriptions/${subscriptionId}`, { data: { expirationDateTime: expiration } });
    return { expiresAt: r.data.expirationDateTime };
  }

  /** Graph message resource → NormalizedEmail. externalMessageId is the Graph id
   *  (needed for reply/read); threadKey is the server conversationId. */
  _normalize(m) {
    const addr = (r) => (r && r.emailAddress ? r.emailAddress.address : null);
    const isHtml = m.body && m.body.contentType && String(m.body.contentType).toUpperCase() === "HTML";
    return {
      externalMessageId: m.id,
      threadKey: m.conversationId || m.internetMessageId || m.id,
      // The engine decides direction from the folder (Sent and Drafts are ours).
      direction: "IN",
      from: m.from ? addr(m.from) : null,
      fromName: nameOf(m.from),
      to: (m.toRecipients || []).map(addr).filter(Boolean),
      cc: (m.ccRecipients || []).map(addr).filter(Boolean),
      subject: m.subject || null,
      bodyHtml: isHtml && m.body ? m.body.content : null,
      bodyText: !isHtml && m.body ? m.body.content : (m.bodyPreview || null),
      attachments: [], // hydrated by _fetchAttachments when hasAttachments
      inReplyTo: null,
      references: [],
      messageIdHeader: m.internetMessageId || null,
      receivedAt: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(),
      isRead: m.isRead === true,
      provider: "microsoft_graph",
    };
  }
}

/**
 * The sender's display name, or null. Exchange fills `name` with the address
 * itself when there is none, and an address printed twice is not a name.
 */
function nameOf(recipient) {
  const e = recipient && recipient.emailAddress;
  const name = e && typeof e.name === "string" ? e.name.trim() : "";
  if (!name || (e.address && name.toLowerCase() === String(e.address).toLowerCase())) return null;
  return name;
}

function graphError(err) {
  const d = err && err.response && err.response.data;
  if (d && d.error && d.error.message) return d.error.message;
  return err && err.message ? err.message : "graph request failed";
}

module.exports = { MicrosoftGraphProvider, graphError, CURSOR_V, SUBSCRIPTION_RESOURCE };
