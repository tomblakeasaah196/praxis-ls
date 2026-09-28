/**
 * Client portal (redesign, PR 1) — HTTP handlers for the new client screens and
 * their staff half. Mounted from `portal_auth.routes.js` (basePath /portal),
 * beside the rest of the external portal.
 *
 * The client half takes its client from the GRANT (`req.portal.clientId`, set by
 * portalAuth("CLIENT")) and nothing else, for the reason the portal controller
 * states: a query parameter here would let one client read another's data.
 */
"use strict";
const service = require("./portal_client.service");
const bundles = require("./invoice_bundle.service");
const chat = require("./portal_chat.service");
const authService = require("../portal_auth/portal_auth.service");
const authController = require("../portal_auth/portal_auth.controller");
const { readUpload } = require("../../shared/http/upload.middleware");
const { asyncHandler, AppError } = require("../../utils/errors");

const clientId = (req) => {
  const id = req.portal && req.portal.clientId;
  if (!id) throw new AppError("CLIENT_REQUIRED", "A CLIENT portal grant with a client scope is required", 422);
  return id;
};
const scopeOf = (req) => (req.portal && req.portal.scope) || "ALL";
const langOf = (req) => (req.query.lang === "fr" ? "fr" : "en");
const emailOf = (req) => (req.portal && req.portal.user && req.portal.user.email) || null;
const slugOf = (req) => (req.tenant && req.tenant.slug) || "tenant";
const staff = (req) => req.user || { user_id: null };

/** Bytes back to the browser as a download, never rendered inline. */
function sendFile(res, { buffer, name, type = "application/octet-stream" }) {
  const safe = String(name || "document").replace(/[^\w.-]+/g, "_");
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(buffer);
}

/**
 * A chat photo or voice note, shown IN the conversation rather than saved.
 * Only kinds whose bytes were sniffed at upload (a JPEG/PNG/WebP, an audio
 * container) are ever marked inline, and the response still refuses to be
 * anything else: nosniff, and a CSP that forbids it running or loading
 * anything if someone opens the URL on its own. An attachment never changes
 * once sent, so the browser may keep it.
 */
function sendAttachment(res, { buffer, name, type, inline }) {
  if (!inline) return sendFile(res, { buffer, name, type });
  const safe = String(name || "attachment").replace(/[^\w.-]+/g, "_");
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", `inline; filename="${safe}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, max-age=604800, immutable");
  return res.send(buffer);
}

/* ── the chat's request shapes (14170) ─────────────────────────────────── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `?thread=` — "general" or a shipment id; anything else is refused, not queried. */
function threadOf(v) {
  if (v === undefined || v === null || v === "" || v === "general") return "general";
  if (UUID.test(String(v))) return String(v);
  throw new AppError("VALIDATION_ERROR", "thread must be 'general' or a shipment id", 422);
}
/** An id from the URL, checked before it reaches a uuid column. */
function uuidOf(v, name) {
  if (UUID.test(String(v || ""))) return String(v);
  throw new AppError("VALIDATION_ERROR", `${name} must be an id`, 422);
}
/** `?before=` — an instant, for paging back through a long thread. */
function beforeOf(v) {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError("VALIDATION_ERROR", "before must be a date-time", 422);
  return d.toISOString();
}
const meOf = (req) => ({ portal_user_id: req.portal.user.portal_user_id, email: req.portal.user.email });
/** When this person's access began — "unread" never reaches back past it. */
const sinceOf = (req) => (req.portal.grant && req.portal.grant.created_at) || null;
const chatMeta = (b) => ({ width: b.width, height: b.height, durationMs: b.duration_ms });

module.exports = {
  // ── client ──
  home: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.home(c, { clientId: clientId(req), scope: scopeOf(req), lang: langOf(req), me: meOf(req), since: sinceOf(req) })),
    });
  }),
  shipments: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.shipments(c, { clientId: clientId(req), state: req.query.state, lang: langOf(req) })) });
  }),
  shipment: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.shipment(c, { clientId: clientId(req), dossierId: req.params.id, scope: scopeOf(req), lang: langOf(req) })),
    });
  }),
  requests: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.requests(c, { clientId: clientId(req) })) });
  }),
  documentTypes: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.documentTypes(c)) });
  }),
  uploadForRequest: asyncHandler(async (req, res) => {
    const file = readUpload(req);
    res.status(201).json({
      data: await req.tenantDb((c) =>
        service.uploadForRequest(c, { clientId: clientId(req), requestId: req.params.id, file, email: emailOf(req), slug: slugOf(req) })),
    });
  }),
  answerRequest: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.answerRequest(c, { clientId: clientId(req), requestId: req.params.id, text: req.body.text, email: emailOf(req) })),
    });
  }),
  requestFile: asyncHandler(async (req, res) => {
    sendFile(res, await req.tenantDb((c) => service.requestFile(c, { clientId: clientId(req), requestId: req.params.id })));
  }),
  shareDocument: asyncHandler(async (req, res) => {
    const file = readUpload(req);
    res.status(201).json({
      data: await req.tenantDb((c) =>
        service.shareDocument(c, {
          clientId: clientId(req),
          dossierId: req.body.dossier_id || null,
          docTypeCode: req.body.doc_type_code || null,
          note: req.body.note || null,
          file,
          email: emailOf(req),
          slug: slugOf(req),
        })),
    });
  }),
  billing: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.billing(c, { clientId: clientId(req) })) });
  }),
  invoice: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.invoice(c, { clientId: clientId(req), invoiceId: req.params.invoiceId, lang: langOf(req) })) });
  }),
  invoicePdf: asyncHandler(async (req, res) => {
    const out = await req.tenantDb((c) =>
      service.invoicePdf(c, {
        clientId: clientId(req),
        invoiceId: req.params.invoiceId,
        lang: langOf(req),
        origin: `${req.protocol}://${req.get("host")}`,
        env: req.env || "live",
      }));
    sendFile(res, { ...out, type: "application/pdf" });
  }),
  submitProof: asyncHandler(async (req, res) => {
    const file = readUpload(req);
    const b = req.body;
    res.status(201).json({
      data: await req.tenantDb((c) =>
        service.submitProof(c, {
          clientId: clientId(req),
          email: emailOf(req),
          amount: b.amount,
          currency: b.currency || "XAF",
          method: b.method,
          provider: b.provider || null,
          paidOn: b.paid_on,
          reference: b.reference || null,
          note: b.note || null,
          dossierId: b.dossier_id || null,
          allocations: b.allocations || [],
          file,
          slug: slugOf(req),
        })),
    });
  }),
  proofFile: asyncHandler(async (req, res) => {
    sendFile(res, await req.tenantDb((c) => service.proofFile(c, { proofId: req.params.id, clientId: clientId(req) })));
  }),

  // ── the client's own team ──
  /**
   * Colleagues on this client account. The grants are tenant data and the
   * logins are identity data, so the two are read separately and joined here
   * by email — which is also how the grant was issued.
   */
  team: asyncHandler(async (req, res) => {
    const grants = await req.tenantDb((c) => service.team(c, { clientId: clientId(req) }));
    const users = await req.identityDb((c) => authService.usersByEmails(c, grants.map((g) => g.email)));
    const byEmail = new Map(users.map((u) => [String(u.email).toLowerCase(), u]));
    const self = req.portal.grant && req.portal.grant.portal_access_id;
    res.json({
      data: {
        can_manage: req.portal.grant && req.portal.grant.is_client_admin === true,
        members: grants.map((g) => {
          const u = byEmail.get(String(g.email).toLowerCase());
          return {
            ...g,
            full_name: (u && u.full_name) || null,
            last_login_at: (u && u.last_login_at) || null,
            // Never signed in = the invite is still waiting to be accepted.
            pending: !u || !u.last_login_at,
            is_you: g.portal_access_id === self,
          };
        }),
      },
    });
  }),
  teamInvite: asyncHandler(async (req, res) => {
    const cid = clientId(req);
    const grant = await req.tenantDb((c) =>
      service.addTeamMember(c, {
        clientId: cid,
        email: req.body.email,
        scope: req.body.access_scope || "ALL",
        isAdmin: req.body.is_client_admin === true,
        invitedBy: emailOf(req),
      }));
    const name = await authController.tenantName(req);
    const origin = await authController.portalLinkOrigin(req);
    const invited = await req.identityDb((c) =>
      authService.inviteUser(c, { email: req.body.email, fullName: req.body.full_name, ip: req.ip, origin, tenantName: name }));
    res.status(201).json({ data: { ...grant, emailed: invited.emailed } });
  }),
  teamUpdate: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.updateTeamMember(c, {
          clientId: clientId(req),
          grantId: req.params.id,
          scope: req.body.access_scope,
          isAdmin: req.body.is_client_admin,
          selfGrantId: req.portal.grant && req.portal.grant.portal_access_id,
        })),
    });
  }),
  teamRemove: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.removeTeamMember(c, {
          clientId: clientId(req),
          grantId: req.params.id,
          selfGrantId: req.portal.grant && req.portal.grant.portal_access_id,
        })),
    });
  }),

  // An invoice's supporting documents (14160): the list, one file, all as a ZIP.
  invoiceDocuments: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => bundles.clientView(c, { clientId: clientId(req), invoiceId: req.params.invoiceId })) });
  }),
  invoiceDocumentsZip: asyncHandler(async (req, res) => {
    sendFile(res, await req.tenantDb((c) =>
      bundles.clientZip(c, {
        clientId: clientId(req),
        invoiceId: req.params.invoiceId,
        invoicePdf: () => service.invoicePdf(c, { clientId: clientId(req), invoiceId: req.params.invoiceId, lang: langOf(req), origin: `${req.protocol}://${req.get("host")}`, env: req.env || "live" }),
      })));
  }),
  invoiceDocument: asyncHandler(async (req, res) => {
    sendFile(res, await req.tenantDb((c) => bundles.clientFile(c, { clientId: clientId(req), invoiceId: req.params.invoiceId, docId: req.params.docId })));
  }),

  // The chat (14170): General and one thread per shipment.
  chatThreads: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        chat.threads(c, { clientId: clientId(req), me: meOf(req), scope: scopeOf(req), since: sinceOf(req) })),
    });
  }),
  // The badge on the chat button — one count, cheap enough to poll.
  chatUnread: asyncHandler(async (req, res) => {
    res.json({
      data: { unread: await req.tenantDb((c) => chat.unread(c, { clientId: clientId(req), me: meOf(req), scope: scopeOf(req), since: sinceOf(req) })) },
    });
  }),
  chatMessages: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        chat.messages(c, {
          clientId: clientId(req), me: meOf(req), scope: scopeOf(req),
          thread: threadOf(req.query.thread), before: beforeOf(req.query.before), lang: langOf(req),
        })),
    });
  }),
  chatSend: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({
      data: await req.tenantDb((c) =>
        chat.send(c, {
          clientId: clientId(req), me: meOf(req), scope: scopeOf(req),
          thread: b.thread || "general", body: b.body, milestoneId: b.milestone_instance_id || null,
          location: b.lat !== undefined ? { lat: b.lat, lng: b.lng, label: b.location_label || null } : null,
          file: req.file || null, meta: chatMeta(b), slug: slugOf(req), lang: langOf(req),
        })),
    });
  }),
  chatRead: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        chat.read(c, { clientId: clientId(req), me: meOf(req), scope: scopeOf(req), thread: req.body.thread || "general", at: req.body.at || null })),
    });
  }),
  chatAttachment: asyncHandler(async (req, res) => {
    sendAttachment(res, await req.tenantDb((c) =>
      chat.clientAttachment(c, {
        clientId: clientId(req), scope: scopeOf(req), attachmentId: uuidOf(req.params.attachmentId, "attachmentId"),
        size: req.query.size === "preview" ? "preview" : null,
      })));
  }),

  // ── staff ──
  staffChatThreads: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => chat.staffThreads(c, { clientId: uuidOf(req.query.client_id, "client_id") })) });
  }),
  staffChatMessages: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        chat.staffMessages(c, { clientId: uuidOf(req.query.client_id, "client_id"), thread: threadOf(req.query.thread), before: beforeOf(req.query.before) })),
    });
  }),
  staffChatSend: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({
      data: await req.tenantDb((c) =>
        chat.staffSend(c, {
          clientId: b.client_id, thread: b.thread || "general", body: b.body,
          milestoneId: b.milestone_instance_id || null, file: req.file || null, meta: chatMeta(b),
          actor: staff(req), slug: slugOf(req),
        })),
    });
  }),
  staffChatRead: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => chat.staffRead(c, { clientId: req.body.client_id, thread: req.body.thread || "general" })) });
  }),
  staffChatAttachment: asyncHandler(async (req, res) => {
    sendAttachment(res, await req.tenantDb((c) =>
      chat.staffAttachment(c, { attachmentId: uuidOf(req.params.attachmentId, "attachmentId"), size: req.query.size === "preview" ? "preview" : null })));
  }),
  staffInvoiceBundle: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => bundles.staffView(c, { invoiceId: req.params.invoiceId })) });
  }),
  staffPublishBundle: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => bundles.publish(c, { invoiceId: req.params.invoiceId, docIds: req.body.doc_ids, actor: staff(req) })) });
  }),
  staffWithdrawBundle: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => bundles.withdraw(c, { invoiceId: req.params.invoiceId, actor: staff(req) })) });
  }),
  staffRequests: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.staffRequests(c, { clientId: req.query.client_id || null, status: req.query.status || null })),
    });
  }),
  staffCreateRequest: asyncHandler(async (req, res) => {
    const b = req.body;
    res.status(201).json({
      data: await req.tenantDb((c) =>
        service.createRequest(c, {
          clientId: b.client_id,
          dossierId: b.dossier_id || null,
          kind: b.kind,
          docTypeCode: b.doc_type_code || null,
          title: b.title || null,
          note: b.note || null,
          dueOn: b.due_on || null,
          actor: staff(req),
        })),
    });
  }),
  staffReviewRequest: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.reviewRequest(c, { requestId: req.params.id, decision: req.body.decision, note: req.body.note || null, actor: staff(req) })),
    });
  }),
  staffRequestFile: asyncHandler(async (req, res) => {
    sendFile(res, await req.tenantDb((c) => service.staffRequestFile(c, { requestId: req.params.id })));
  }),
  staffProofs: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.staffProofs(c, { status: req.query.status || null, clientId: req.query.client_id || null })),
    });
  }),
  staffConfirmProof: asyncHandler(async (req, res) => {
    res.json({
      data: await req.tenantDb((c) =>
        service.confirmProof(c, { proofId: req.params.id, treasuryAccountId: req.body.treasury_account_id || null, actor: staff(req) })),
    });
  }),
  staffRejectProof: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.rejectProof(c, { proofId: req.params.id, note: req.body.note, actor: staff(req) })) });
  }),
  staffProofFile: asyncHandler(async (req, res) => {
    sendFile(res, await req.tenantDb((c) => service.proofFile(c, { proofId: req.params.id })));
  }),
};
