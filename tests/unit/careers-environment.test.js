"use strict";
/**
 * Which environment a careers link opens in.
 *
 * WHAT BROKE. The public page is unauthenticated, so a candidate sends no
 * `X-Praxis-Env` and tenant-context resolves them to LIVE. But the client
 * attaches that header from the VIEWER's localStorage — so whether a careers
 * link worked depended on who was holding it: it opened for the recruiter who
 * had just been in Test, and answered "no longer accepting applications" to the
 * candidate they sent it to. A public URL has to mean the same thing to
 * everyone.
 *
 * SO THE TOKEN DECIDES. It is minted per vacancy and is the only way in, which
 * makes it the one thing both viewers share. Live is tried first so a real role
 * can never be shadowed by a rehearsal, the environment travels with the answer
 * so the page can badge a Test posting as TEST, and an application is written
 * where the role lives rather than somewhere its recruiter will never look.
 */

const service = require("../../src/modules/hr/careers/careers.service");
const vacancyRepo = require("../../src/modules/hr/vacancy/vacancy.repo");

/** A request whose two environments hold different rows. */
function fakeReq({ live = null, sandbox = null, hasSandbox = true } = {}) {
  const seen = [];
  return {
    seen,
    tenant: { slug: "t", sandbox_schema: hasSandbox ? "sandbox_schema" : null },
    tenantDbIn(env, fn) {
      seen.push(env);
      return fn({ env });
    },
  };
}

beforeEach(() => {
  jest.spyOn(vacancyRepo, "publishedByToken").mockImplementation(async (client) =>
    client.env === "live" ? global.__live : global.__sandbox,
  );
});
afterEach(() => {
  jest.restoreAllMocks();
  delete global.__live;
  delete global.__sandbox;
});

describe("careers — the token chooses the environment", () => {
  it("serves a live role and says so", async () => {
    global.__live = { vacancy_id: "v1", title: "Accountant", public_token: "tok", skills_required: [] };
    const req = fakeReq();

    const out = await service.get(req, "tok");
    expect(out.title).toBe("Accountant");
    expect(out.environment).toBe("live");
    // Found in live: the second schema is never touched.
    expect(req.seen).toEqual(["live"]);
  });

  it("falls through to Test, and marks the page TEST", async () => {
    global.__sandbox = { vacancy_id: "v2", title: "Rehearsal", public_token: "tok", skills_required: [] };
    const req = fakeReq();

    const out = await service.get(req, "tok");
    expect(out.title).toBe("Rehearsal");
    // This is what the public page badges on.
    expect(out.environment).toBe("sandbox");
    expect(req.seen).toEqual(["live", "sandbox"]);
  });

  it("prefers live when a token somehow exists in both", async () => {
    global.__live = { vacancy_id: "v1", title: "Real", public_token: "tok", skills_required: [] };
    global.__sandbox = { vacancy_id: "v2", title: "Rehearsal", public_token: "tok", skills_required: [] };

    const out = await service.get(fakeReq(), "tok");
    expect(out.title).toBe("Real");
  });

  it("carries a live role's photograph, and drops a Test role's (14720)", async () => {
    const cover = { cover_id: "d1", cover_variants: { widths: [480, 960], formats: ["avif", "webp"] } };
    global.__live = { vacancy_id: "v1", title: "Accountant", public_token: "tok", skills_required: [], ...cover };
    expect((await service.get(fakeReq(), "tok")).cover).toEqual({
      id: "d1",
      variants: { widths: [480, 960], formats: ["avif", "webp"] },
    });

    // The public media route reads LIVE only: a Test role's picture is not an
    // address a candidate's browser could load, so the JSON does not name it.
    delete global.__live;
    global.__sandbox = { vacancy_id: "v2", title: "Rehearsal", public_token: "tok", skills_required: [], ...cover };
    expect((await service.get(fakeReq(), "tok")).cover).toBeNull();
  });

  it("names no photograph when the recruiter chose none", async () => {
    global.__live = { vacancy_id: "v1", title: "Accountant", public_token: "tok", skills_required: [], cover_id: null };
    expect((await service.get(fakeReq(), "tok")).cover).toBeNull();
  });

  it("keeps a confidential salary out of the public JSON", async () => {
    global.__live = {
      vacancy_id: "v1", title: "Accountant", public_token: "tok", skills_required: [],
      salary_hidden: true, salary_min: "400000", salary_max: "600000", salary_currency: "XAF",
    };
    const out = await service.get(fakeReq(), "tok");
    expect(out.salary_hidden).toBe(true);
    expect(out).not.toHaveProperty("salary_min");
    expect(out).not.toHaveProperty("salary_max");
  });

  it("does not pay for a second lookup on a workspace with no Test schema", async () => {
    const req = fakeReq({ hasSandbox: false });
    await expect(service.get(req, "tok")).rejects.toMatchObject({ status: 404 });
    expect(req.seen).toEqual(["live"]);
  });

  it("still refuses an unknown token the same way, in both", async () => {
    const req = fakeReq();
    // Closed, unpublished and never-existed are deliberately indistinguishable
    // — nobody should be able to enumerate a company's vacancies.
    await expect(service.get(req, "nope")).rejects.toMatchObject({
      status: 404,
      message: "This role is no longer accepting applications",
    });
  });
});

/**
 * A rejected CV reaches the candidate.
 *
 * WHAT BROKE. The apply path caught upload failures and asked
 * `err.httpStatus < 500` to tell "your file is wrong" from "our storage
 * failed". `AppError` has never had `httpStatus` — it exposes `status` — so the
 * test read `undefined < 500`, which is false, and EVERY rejection was swallowed
 * as though it were our fault. A candidate whose file was 20 MB, or a .docx, or
 * a renamed .exe, was told "We could not attach your CV. Your application is
 * safe — please email it to us separately", when the truth was one they could
 * have fixed in ten seconds. The comment above the line already said they must
 * be told; only the property name was wrong.
 */
describe("careers — a rejected CV is the candidate's to fix", () => {
  const service = require("../../src/modules/hr/careers/careers.service");
  const vault = require("../../src/modules/vault/document_vault/document_vault.service");
  const vacancyService = require("../../src/modules/hr/vacancy/vacancy.service");
  const { AppError } = require("../../src/utils/errors");

  const ROLE = { vacancy_id: "v1", title: "Accountant", public_token: "tok", apply_config: {} };
  const req = () => ({
    tenant: { slug: "t", sandbox_schema: null },
    tenantDbIn: (_env, fn) => fn({ env: "live" }),
  });

  beforeEach(() => {
    jest.spyOn(vacancyRepo, "publishedByToken").mockResolvedValue(ROLE);
    jest.spyOn(vacancyService, "addApplicant").mockResolvedValue({ applicant_id: "a1" });
  });
  afterEach(() => jest.restoreAllMocks());

  const submit = () =>
    service.applyToToken(req(), {
      token: "tok",
      data: { full_name: "Ada", email: "ada@example.com", cv_data_url: "data:application/pdf;base64,AAAA" },
      slug: "t",
    });

  it.each([
    ["too large", new AppError("FILE_TOO_LARGE", "File exceeds 8 MB", 413)],
    ["the wrong type", new AppError("BAD_FILE_TYPE", "This file is not a PDF or an image", 422)],
  ])("tells them when the file is %s", async (_label, err) => {
    jest.spyOn(vault, "createDocument").mockRejectedValue(err);
    await expect(submit()).rejects.toMatchObject({ code: err.code });
    // Refused outright: no half-application recorded behind a misleading
    // "we got you, but not your file".
    expect(vacancyService.addApplicant).not.toHaveBeenCalled();
  });

  it("keeps the application when the failure is OURS", async () => {
    jest.spyOn(vault, "createDocument").mockRejectedValue(new AppError("STORAGE_DOWN", "bucket unreachable", 502));
    const out = await submit();
    // Losing the candidate over our own outage is the worse of the two errors.
    expect(out.received).toBe(true);
    expect(out.cv_attached).toBe(false);
    expect(vacancyService.addApplicant).toHaveBeenCalled();
  });
});

/**
 * Reading the CV, and saying honestly why it was not read.
 *
 * TWO FAULTS, ONE SYMPTOM. `vision.extract` resolved its key from
 * `GEMINI_API_KEY` and nowhere else, so on a deployment whose models are
 * configured in AI Control — which is what AI Control is for — every assessment
 * came back "scored without the CV". The panel then told the recruiter "the
 * uploaded file could not be read", about a PDF sitting in the vault, marked
 * Verified, that opens perfectly well. One of those is an administrator's
 * problem and the other is the candidate's, and the screen said the wrong one.
 */
describe("vacancy.scoring — reading the CV", () => {
  const scoring = require("../../src/modules/hr/vacancy/vacancy.scoring");
  const vault = require("../../src/modules/vault/document_vault/document_vault.service");
  const vision = require("../../src/services/ai/vision.service");
  const llm = require("../../src/services/ai/llm.service");

  beforeEach(() => {
    jest.spyOn(vault, "fetchBytes").mockResolvedValue({
      doc: { doc_id: "d1", mime_type: "application/pdf" },
      buffer: Buffer.from("%PDF-1.4"),
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it("uses the vendor the tenant configured, not just the process env", async () => {
    const vendor = { api_key: "k", endpoint_url: "https://x", model: "gemini-2.0" };
    jest.spyOn(llm, "resolveVendor").mockResolvedValue(vendor);
    const extract = jest.spyOn(vision, "extract").mockResolvedValue({ raw: "Ada, 5 years" });

    const out = await scoring.readCv({}, "cv1");
    expect(out.text).toContain("Ada");
    expect(out.reason).toBeNull();
    // The key from AI Control reaches the provider — without this the call
    // throws "not configured" on every deployment that set one there.
    expect(extract.mock.calls[0][0].vendor).toBe(vendor);
  });

  it("calls an unconfigured provider what it is, not an unreadable file", async () => {
    jest.spyOn(llm, "resolveVendor").mockResolvedValue(null);
    jest
      .spyOn(vision, "extract")
      .mockRejectedValue(new Error("document-vision provider not configured (Gemini key missing)"));

    const out = await scoring.readCv({}, "cv1");
    expect(out.text).toBeNull();
    // The panel branches on this to stop blaming the candidate's PDF.
    expect(out.reason).toBe("no_provider");
  });

  it("still calls a genuinely unreadable file unreadable", async () => {
    jest.spyOn(llm, "resolveVendor").mockResolvedValue({ api_key: "k" });
    jest.spyOn(vision, "extract").mockRejectedValue(new Error("400 unsupported media"));

    expect((await scoring.readCv({}, "cv1")).reason).toBe("unreadable");
  });

  it("reports no reason at all when there was no CV to read", async () => {
    const out = await scoring.readCv({}, null);
    expect(out).toEqual({ text: null, reason: null });
    expect(vault.fetchBytes).not.toHaveBeenCalled();
  });
});

/**
 * The columns the public careers queries read (14720).
 *
 * `publicVacancy` decides what to omit from fields the QUERY must supply. The
 * 0684 columns were missing from both statements, so `salary_hidden` was
 * always undefined and a confidential band was published anyway, and
 * `apply_config` was always `{}` so the required covering note was never
 * required. Pinned on the SQL itself, since a mocked repo cannot see it.
 */
describe("careers — the public queries select what the public shape reads", () => {
  const COLUMNS = [
    "salary_hidden", "apply_config", "work_mode", "working_hours", "days_on_site",
    "days_off_site", "days_off", "probation_months", "location_city", "location_state",
    "location_country", "target_start_date", "cover_id", "cover_variants",
  ];
  const capture = () => {
    const seen = [];
    return { seen, client: { query: async (text) => { seen.push(String(text)); return { rows: [] }; } } };
  };

  it.each(["publishedList", "publishedByToken"])("%s", async (fn) => {
    // The file-level beforeEach stubs the token lookup; this reads the real SQL.
    jest.restoreAllMocks();
    const { seen, client } = capture();
    await vacancyRepo[fn](client, "tok");
    for (const c of COLUMNS) expect(seen[0]).toMatch(new RegExp(`\\b${c}\\b`));
    // The photograph is joined on the clauses the public media route
    // re-asserts, so the JSON never names a picture the route would 404.
    expect(seen[0]).toMatch(/d\.public_media_scope = 'SITE'/);
    expect(seen[0]).toMatch(/d\.public_media_role = 'ATMOSPHERE'/);
    expect(seen[0]).toMatch(/d\.status = 'VERIFIED'/);
  });
});
