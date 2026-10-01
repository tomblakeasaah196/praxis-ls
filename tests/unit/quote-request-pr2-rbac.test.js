"use strict";

/**
 * The quote-request routes PR 2 (meeting 6) added, behind the REAL middleware
 * chain and a NON-CEO user — the CEO bypasses `requirePermission`, so a test as
 * the CEO proves nothing about who else can call these.
 *
 *   GET  /quote-requests/services                  view  — the desk's service picker
 *   GET  /quote-requests/client-match              view  — "this address belongs to…"
 *   POST /quote-requests/:id/attachments/from-chat edit  — "File on a quote request"
 *
 * The router is the module's own; only the controller is replaced (so nothing
 * needs Postgres), and the tenant registry and identity cache are mocked as in
 * no-access-boundary.test.js.
 */

require("../../src/shared/http/async-safe");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");

let mockTenants = {};
let mockAuthUser = null;
let mockGrants = [];

jest.mock("../../src/services/tenant/registry.service", () => {
  const db = {
    async query(sql) {
      return /user_session/.test(sql) ? { rows: [{ killed_at: null }] } : { rows: [] };
    },
  };
  return {
    SCHEMA: Symbol.for("praxis.schema"),
    resolveByHost: async (host) => mockTenants[host] || null,
    acquire: async () => ({ ...db, release() {} }),
    withTenantConnection: async (_t, _e, fn) => fn(db),
    invalidateHost: () => {},
    poolFor: () => null,
    listActiveTenants: async () => [],
    poolStats: () => ({}),
    hostCacheStats: () => ({}),
    closeAll: async () => {},
  };
});

jest.mock("../../src/shared/cache/identity-cache", () => ({
  getAuthUser: async () => mockAuthUser,
  getGrants: async () => mockGrants,
  getUserScopeClosure: async () => [],
  getUserScopeIds: async () => [],
  invalidateUser: async () => {},
  invalidateGrants: async () => {},
  getApprovableModules: async () => [],
  getUserCapabilities: async () => [],
  getMaskedFieldKeys: async () => [],
  bumpScopeVersion: async () => {},
}));

// Every handler answers with its own name, so a 200 says WHICH one ran.
jest.mock("../../src/modules/sales/quote_request/quote_request.controller", () => {
  const actual = jest.requireActual("../../src/modules/sales/quote_request/quote_request.controller");
  const out = {};
  for (const k of Object.keys(actual)) out[k] = (_req, res) => res.json({ ran: k });
  return out;
});

const { config } = require("../../src/config/env");
const { requestIdMiddleware } = require("../../src/middleware/request-id");
const { hostTenantResolver } = require("../../src/middleware/host-tenent-resolver");
const { tenantContext } = require("../../src/middleware/tenant-context");
const { errorHandler, notFoundHandler } = require("../../src/middleware/error-handler");
const quoteRequests = require("../../src/modules/sales/quote_request/quote_request.routes");

const HOST = `acme.${config.APP_BASE_DOMAIN}`;
const QR = "11111111-1111-4111-8111-111111111111";
const CHAT = "22222222-2222-4222-8222-222222222222";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  const tenantRouter = express.Router();
  tenantRouter.use(hostTenantResolver, tenantContext);
  tenantRouter.use(quoteRequests.basePath, quoteRequests.router);
  app.use("/api", tenantRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const app = buildApp();
const token = () => jwt.sign({ sub: "u-1", typ: "access", sid: "s-1", jti: "j-1" }, config.JWT_ACCESS_SECRET, { expiresIn: "15m" });
const call = (method, path) => {
  const req = request(app);
  return req[method](path).set("Host", HOST).set("Authorization", `Bearer ${token()}`);
};

beforeEach(() => {
  mockTenants = {
    [HOST]: { tenant_id: "t-1", slug: "acme", status: "LIVE", is_live: true, live_schema: "live", sandbox_schema: "sandbox" },
  };
  // A sales coordinator: authenticated, active, and NOT the CEO.
  mockAuthUser = {
    user_id: "u-1",
    email: "sales@acme.example",
    display_name: "Sales",
    status: "ACTIVE",
    role_ids: ["r-sales"],
    is_ceo: false,
  };
  mockGrants = [];
});

describe("a non-CEO user with MOD-20 view only", () => {
  beforeEach(() => {
    mockGrants = [{ can_read: true, can_create: false, can_update: false }];
  });

  test("reads the services a request can name", async () => {
    const res = await call("get", "/api/quote-requests/services").expect(200);
    expect(res.body.ran).toBe("services");
  });

  test("asks which client an address belongs to", async () => {
    const res = await call("get", "/api/quote-requests/client-match?email=ops%40tema-shipping.com").expect(200);
    expect(res.body.ran).toBe("clientMatch");
  });

  test("cannot file a chat file on a request — that is an edit", async () => {
    const res = await call("post", `/api/quote-requests/${QR}/attachments/from-chat`).send({ chat_attachment_id: CHAT }).expect(403);
    expect(res.body.error.message).toBe("No permission for MOD-20.edit");
  });

  test("/services is not swallowed by /:id", async () => {
    const res = await call("get", "/api/quote-requests/services").expect(200);
    expect(res.body.ran).not.toBe("get");
  });
});

describe("a non-CEO user with MOD-20 edit", () => {
  beforeEach(() => {
    mockGrants = [{ can_read: true, can_update: true }];
  });

  test("files a chat file on a request", async () => {
    const res = await call("post", `/api/quote-requests/${QR}/attachments/from-chat`)
      .send({ chat_attachment_id: CHAT, document_kind: "COMMERCIAL_INVOICE" })
      .expect(200);
    expect(res.body.ran).toBe("fileFromChat");
  });

  test("the body is validated by the shared rule — an unknown document kind is a 422", async () => {
    const res = await call("post", `/api/quote-requests/${QR}/attachments/from-chat`)
      .send({ chat_attachment_id: CHAT, document_kind: "SELFIE" })
      .expect(422);
    expect(res.body.ran).toBeUndefined();
  });
});

describe("a non-CEO user with no MOD-20 grant", () => {
  test.each([
    ["get", "/api/quote-requests/services"],
    ["get", "/api/quote-requests/client-match?email=a%40b.cm"],
  ])("is refused %s %s", async (method, path) => {
    const res = await call(method, path).expect(403);
    expect(res.body.error.code).toBe("PERMISSION_DENIED");
  });
});
