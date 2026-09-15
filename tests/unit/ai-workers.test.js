"use strict";
// The transcription service now resolves its key platform-first (like llm.service),
// so the "not configured" assertions below must pin the platform lookup to null —
// otherwise the real service would spend the DB connect timeout on a pool that
// does not exist in unit tests before falling back to the (empty) env key.
jest.mock("../../src/services/platform/ai-vendor.service", () => ({
  getConfig: jest.fn().mockResolvedValue(null),
}));

const aiTranscribe = require("../../src/jobs/handlers/ai-transcribe");
const transcription = require("../../src/services/ai/transcription.service");
const vision = require("../../src/services/ai/vision.service");

describe("worker-ai handlers: input guards (no DB)", () => {
  test("ai-transcribe rejects missing job data before touching a tenant", async () => {
    await expect(aiTranscribe({ data: {} })).rejects.toThrow(
      /tenantMeta \+ user \+ audioBase64/,
    );
  });
  /**
   * The `ai-vision` handler's guard test used to sit here.
   *
   * The handler is gone. It was registered in `workers.js` and enqueued by
   * nothing — a worker for an assistant image flow that has no route, no
   * validator and no upload control, so no job could ever reach it. The general
   * orphan sweep (tests/security/orphan-wiring-sweep.test.js) is what surfaced
   * it, and that sweep is now what stands in this test's place: it fails if any
   * registered worker has no producer, which is the defect this file could not
   * have caught however well it tested the handler's arguments.
   *
   * `vision.service` itself is untouched and still exercised below — the
   * capability has three live callers, including mail's attachment extraction.
   */
});

describe("provider services: validation", () => {
  test("transcribe rejects empty/absent audio or missing provider", async () => {
    await expect(
      transcription.transcribe({
        audio: Buffer.alloc(0),
        vendor: { api_key: "x", endpoint_url: "http://y" },
      }),
    ).rejects.toThrow(/non-empty audio Buffer/);
    await expect(
      transcription.transcribe({ audio: Buffer.from("hi"), vendor: null }),
    ).rejects.toThrow(/not configured|audio Buffer/);
  });
  test("transcribe resolves the platform console key when no vendor is passed", async () => {
    // Keys moved to the platform console (0060); the direct callers (mail
    // dictation, smartcomm voice notes, HR intake) pass no vendor, so the
    // service itself must find the console key. With one resolved, the
    // missing-key guard no longer fires — the next rejection is the empty
    // buffer guard, and nothing network-bound runs before it.
    const vendors = require("../../src/services/platform/ai-vendor.service");
    vendors.getConfig.mockResolvedValueOnce({
      vendor: "groq",
      api_key: "gk",
      endpoint_url: "https://api.groq.com/openai/v1",
      model: "whisper-large-v3",
      is_active: true,
    });
    await expect(
      transcription.transcribe({ audio: Buffer.alloc(0), vendor: null }),
    ).rejects.toThrow(/non-empty audio Buffer/);
  });
  test("an inactive platform vendor row falls through to the env fallback", async () => {
    const vendors = require("../../src/services/platform/ai-vendor.service");
    vendors.getConfig.mockResolvedValueOnce({
      vendor: "groq",
      api_key: "gk",
      endpoint_url: "https://api.groq.com/openai/v1",
      model: "whisper-large-v3",
      is_active: false,
    });
    await expect(
      transcription.transcribe({ audio: Buffer.from("hi"), vendor: null }),
    ).rejects.toThrow(/not configured/);
  });
  test("vision extract rejects empty image or missing provider", async () => {
    await expect(
      vision.extract({ image: Buffer.alloc(0), vendor: { api_key: "x" } }),
    ).rejects.toThrow(/non-empty image Buffer/);
    await expect(
      vision.extract({ image: Buffer.from([1, 2, 3]), vendor: null }),
    ).rejects.toThrow(/not configured|image Buffer/);
  });
});
