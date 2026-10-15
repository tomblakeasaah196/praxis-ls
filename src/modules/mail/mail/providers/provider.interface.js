/**
 * EmailProvider — the single interface every mail adapter implements. The mail
 * engine (mail.service) depends ONLY on this shape; no business code branches on
 * provider. Design it from what the engine needs, then let each adapter advertise
 * what it can actually do via capabilities() — do NOT shrink it to IMAP's floor.
 *
 * A NormalizedEmail (what fetch/get return, what send/reply accept) is:
 *   { externalMessageId, threadKey, direction ('IN'|'OUT'),
 *     from, fromName, to[], cc[], subject, bodyHtml, bodyText, attachments[],
 *     (each attachment: filename, content_type, size_bytes, content, and for an
 *      inline image its RFC 2392 content_id with disposition 'inline')
 *     inReplyTo, references[], messageIdHeader, receivedAt, isRead, provider }
 *   plus, optionally, `folder` (canonical) and `providerPath`: where the
 *   provider says the message lives NOW, when that is not the folder that was
 *   read. Gmail sets both, because its history is one stream for the mailbox.
 *
 * `isRead` is honoured: a message the server says was read is stored read.
 * The engine decides IN or OUT from the folder as well (Sent and Drafts are
 * ours), so an adapter that cannot tell may leave `direction` as 'IN'.
 *
 * Phase 1 ships ImapSmtpProvider. MicrosoftGraphProvider / GmailProvider (Phase 2)
 * slot in behind the same contract.
 */
"use strict";

/**
 * Default capability set — adapters override the flags they support.
 *
 * EVERY key is declared here, as `false`, rather than left for an adapter to
 * add. An absent key reads as `undefined`, which is falsy, so a capability that
 * is MISSING and one that is DENIED are indistinguishable at the call site —
 * right up until somebody writes `if (caps.folderMove !== false)` and the two
 * stop being the same thing. §3.5 fixes the shape of this object for exactly
 * that reason; `tests/unit/mail-capabilities.test.js` holds every adapter to it.
 */
function baseCapabilities() {
  return {
    push: false,          // provider can webhook us on new mail (Graph/Gmail)
    delta: false,         // provider exposes a delta/history cursor
    serverThreads: false, // provider gives a first-class thread/conversation id
    appendSent: false,    // engine must APPEND sent copies to the Sent folder (SMTP)
    folders: false,       // can enumerate + select folders               (IMAP: yes)
    folderMove: false,    // can MOVE a message between folders           (IMAP: yes)
    serverFlags: false,   // \Seen \Flagged \Answered are server-side     (IMAP: yes)
    serverDrafts: false,  // can APPEND to Drafts        (not used in this programme)
    serverSearch: false,  // provider-side search              (we use Postgres FTS)
    // Can EXPUNGE a message from the mailbox for good           (IMAP: yes).
    // Added for H-1: without it a message deleted in Praxis is still on the
    // server and returns on the next sync, which reads to the user as the
    // delete having silently failed. An adapter that answers false is simply
    // skipped by `propagateToServer`, and the local rows are still removed.
    serverDelete: false,
  };
}

/** The keys every adapter must answer for. Exported so the gate cannot drift. */
const CAPABILITY_KEYS = Object.freeze(Object.keys(baseCapabilities()));

/**
 * Not instantiated directly — documents the contract and gives adapters a base to
 * spread over. Methods that a provider cannot support should be no-ops guided by
 * capabilities() (e.g. IMAP subscribe() returns null; the engine checks push).
 */
const EmailProvider = {
  capabilities() { return baseCapabilities(); },

  // Connection test — never throws; returns {ok, error?}.
  async verify() { throw new Error("verify() not implemented"); },

  // Outbound
  async sendEmail(/* msg */) { throw new Error("sendEmail() not implemented"); },
  async createReply(/* externalMessageId, msg */) { throw new Error("createReply() not implemented"); },

  // Inbound.
  //
  // `fetchSince(cursor, folderPath)` → { messages, nextCursor, removed?, more? }
  //   one folder's share of a sync. `removed` lists { externalMessageId,
  //   fromPath } for mail that LEFT the folder (fromPath null: left the
  //   mailbox); `more` says a first read stopped part way and resumes from
  //   `nextCursor`. A cursor carrying `backfill: true` is still on that first
  //   read, which the engine reads as "do not bill extraction for history".
  async fetchSince(/* cursor, folderPath */) { throw new Error("fetchSince() not implemented"); },
  // OPTIONAL, and deliberately not stubbed here, because the engine reads
  // their PRESENCE (an adapter spreading this object must not acquire them):
  //
  //   listFolders() → [{ path, name, displayName?, flags[] }], with RFC 6154
  //     flags (\Sent, \Junk…) where the server says which is which. Without
  //     it the engine syncs a single INBOX.
  //   locateMessage(externalMessageId) → { path } | null. A PROMISE when
  //     present: a message lives in one folder at a time and keeps its id when
  //     it moves, so the engine moves a stored copy to wherever `fetchSince`
  //     next reports it. IMAP does not have it: a Message-ID can sit in two
  //     folders at once.
  //   translateIds(ids) → Map(old → new). The provider's stored ids were a kind
  //     that changes; see migration 14420.
  // `opts.folderPath` is the provider folder the message was synced from. Only
  // IMAP needs it (a message id is per mailbox there); Graph and Gmail ignore it.
  async getMessage(/* externalMessageId, opts */) { throw new Error("getMessage() not implemented"); },
  // The message as the provider holds it (RFC 822 bytes), or null if it has
  // gone. View source and Download original read it; it is never stored.
  async getRawMessage(/* externalMessageId, opts */) { throw new Error("getRawMessage() not implemented"); },
  async markAsRead(/* externalMessageId */) { throw new Error("markAsRead() not implemented"); },
  // Only called when capabilities().folderMove is true. `fromPath` is where the
  // message is now; returns { moved, externalMessageId? } with the id the
  // server gave it, when that changed.
  async moveMessage(/* externalMessageId, destinationPath, fromPath */) { throw new Error("moveMessage() not implemented"); },
  // Only called when capabilities().serverDelete is true.
  async deleteMessage(/* externalMessageId, fromPath */) { throw new Error("deleteMessage() not implemented"); },

  // Push lifecycle (Phase 2 providers only)
  async subscribe() { return null; },
  async renewSubscription(/* subscriptionId */) { return null; },
};

module.exports = { EmailProvider, baseCapabilities, CAPABILITY_KEYS };
