"use strict";

/**
 * A call's transcript as a conversation: who said what, in order, with when.
 *
 * Each side of a call is recorded and transcribed on its own, in parts of up
 * to two minutes. The transcript row kept a part's words and nothing about
 * when they were said, so a call could only be shown as two blocks: all of the
 * caller, then all of the callee. A tenant asked (17 Nov 2026) for what a
 * transcript is: "X said this, then Y said this."
 *
 * The speech service has always sent the time of each sentence; it was dropped.
 *
 *   1. The speech service's times are kept, cleaned, and stored with the part.
 *   2. The two sides are laid on one clock: a part's offset in its side, plus
 *      the sentence's offset in the part.
 *   3. Sentences become turns: until the other person speaks, or a long pause.
 *   4. A call with NO times (transcribed before this) is not given an invented
 *      order: it stays one block per person.
 *   5. A part with no times, and a stretch with no transcript, appear where
 *      they fall, marked as what they are.
 */

const { cleanSegments } = require("../../src/services/ai/transcription.service");
const pipeline = require("../../src/modules/smartcomm/smartcomm.call.pipeline.service");
const repo = require("../../src/modules/smartcomm/smartcomm.call.repo");

const NAMES = { caller: "Joel Efala", callee: "JBS Praxis" };
const part = (side, index, seconds = 120) => ({ side, part_index: index, duration_seconds: seconds, transcript_status: "OK" });
const row = (side, index, text, segments, language = "en") => ({
  side, part_index: index, text, language, provider: "groq", certified: true, segments,
});
const seg = (start, end, text) => ({ start, end, text });

describe("the speech service's sentence times are kept", () => {
  test("cleaned to start, end and words, in order", () => {
    expect(cleanSegments([
      { id: 1, start: 4.2, end: 7.91234, text: "  from the   computer yes ", tokens: [1, 2], avg_logprob: -0.2 },
      { id: 0, start: 0, end: 3.4, text: "Okay can you hear me" },
    ])).toEqual([
      { start: 0, end: 3.4, text: "Okay can you hear me" },
      { start: 4.2, end: 7.91, text: "from the computer yes" },
    ]);
  });

  test("what cannot be used is dropped, and nothing usable is null", () => {
    expect(cleanSegments([{ start: "x", end: 2, text: "a" }, { start: 1, end: 2, text: "   " }, null, { start: -1, text: "b" }])).toBeNull();
    expect(cleanSegments(undefined)).toBeNull();
    expect(cleanSegments("not a list")).toBeNull();
    // An end that is missing or before the start is the start: never a negative length.
    expect(cleanSegments([{ start: 5, end: 2, text: "a" }, { start: 6, text: "b" }])).toEqual([
      { start: 5, end: 5, text: "a" }, { start: 6, end: 6, text: "b" },
    ]);
  });

  test("a part's row is stored with its times, or with NULL when there are none", async () => {
    const seen = [];
    const client = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [{}] }; } };
    await repo.insertTranscriptRows(client, {
      callId: "c1", side: "caller",
      rows: [
        { partIndex: 1, text: "hello", language: "en", provider: "groq", certified: true, segments: [seg(0, 1, "hello")] },
        { partIndex: 2, text: "bonjour", language: "fr", provider: "gemini", certified: true, segments: null },
      ],
    });
    const insert = seen.find((q) => /INSERT INTO comms_call_transcript/.test(q.sql));
    expect(insert.sql).toMatch(/certified, segments\)/);
    expect(insert.sql).toMatch(/::jsonb\)/);
    expect(insert.params).toContain(JSON.stringify([seg(0, 1, "hello")]));
    expect(insert.params[insert.params.length - 1]).toBeNull();
  });
});

describe("the two sides on one clock", () => {
  test("a part starts where the recorded parts before it end", () => {
    const at = pipeline.partOffsets([part("caller", 1, 120), part("caller", 2, 118), part("caller", 3, 40), part("callee", 1, 119)]);
    expect(at.get("caller:1")).toBe(0);
    expect(at.get("caller:2")).toBe(120);
    expect(at.get("caller:3")).toBe(238);
    expect(at.get("callee:1")).toBe(0);
  });

  test("a part that never arrived still takes its nominal two minutes, so what follows it is not pulled early", () => {
    const at = pipeline.partOffsets([part("caller", 1, 120), part("caller", 3, 60)]);
    expect(at.get("caller:3")).toBe(240);
  });
});

describe("who said what, in order", () => {
  test("sentences from both sides become alternating turns, each with when it began", () => {
    const { timed, turns } = pipeline.buildTurns({
      names: NAMES,
      parts: [part("caller", 1), part("callee", 1)],
      rows: [
        row("caller", 1, "Okay, can you hear me from the computer? Yes, the calls are recorded.", [
          seg(5, 8, "Okay, can you hear me from the computer?"),
          seg(14, 18, "Yes, the calls are recorded."),
        ]),
        row("callee", 1, "From the computer, yes. Oh, it records calls.", [
          seg(9, 11, "From the computer, yes."),
          seg(11.5, 13, "Oh, it records calls."),
        ]),
      ],
    });
    expect(timed).toBe(true);
    expect(turns).toEqual([
      { side: "caller", name: "Joel Efala", at_s: 5, text: "Okay, can you hear me from the computer?", language: "en", exact: true },
      { side: "callee", name: "JBS Praxis", at_s: 9, text: "From the computer, yes. Oh, it records calls.", language: "en", exact: true },
      { side: "caller", name: "Joel Efala", at_s: 14, text: "Yes, the calls are recorded.", language: "en", exact: true },
    ]);
  });

  test("a sentence in a later part is placed by the part's offset: the second part is not replayed from zero", () => {
    const { turns } = pipeline.buildTurns({
      names: NAMES,
      parts: [part("caller", 1, 120), part("caller", 2, 120), part("callee", 1, 120), part("callee", 2, 120)],
      rows: [
        row("caller", 1, "first", [seg(10, 12, "first")]),
        row("caller", 2, "troisième", [seg(20, 22, "troisième")], "fr"),
        row("callee", 1, "second", [seg(100, 103, "second")]),
        row("callee", 2, "fourth", [seg(30, 31, "fourth")]),
      ],
    });
    expect(turns.map((t) => [t.at_s, t.name, t.text, t.language])).toEqual([
      [10, "Joel Efala", "first", "en"],
      [100, "JBS Praxis", "second", "en"],
      [140, "Joel Efala", "troisième", "fr"],
      [150, "JBS Praxis", "fourth", "en"],
    ]);
  });

  test("one person talking on is one turn, until they pause for long", () => {
    const { turns } = pipeline.buildTurns({
      names: NAMES,
      parts: [part("caller", 1)],
      rows: [row("caller", 1, "a b c", [seg(0, 2, "a"), seg(3, 5, "b"), seg(30, 31, "c")])],
    });
    expect(turns.map((t) => [t.at_s, t.text])).toEqual([[0, "a b"], [30, "c"]]);
  });

  test("the order does not depend on which side's rows came back first", () => {
    const rows = [
      row("callee", 1, "second", [seg(4, 5, "second")]),
      row("caller", 1, "first", [seg(1, 2, "first")]),
    ];
    const forward = pipeline.buildTurns({ names: NAMES, parts: [part("caller", 1), part("callee", 1)], rows });
    const reversed = pipeline.buildTurns({ names: NAMES, parts: [part("caller", 1), part("callee", 1)], rows: [...rows].reverse() });
    expect(forward.turns).toEqual(reversed.turns);
    expect(forward.turns.map((t) => t.text)).toEqual(["first", "second"]);
  });

  test("times stored as JSON text are read the same as times stored as JSON", () => {
    const { timed, turns } = pipeline.buildTurns({
      names: NAMES, parts: [part("caller", 1)],
      rows: [row("caller", 1, "hello", JSON.stringify([seg(2, 3, "hello")]))],
    });
    expect(timed).toBe(true);
    expect(turns[0]).toMatchObject({ at_s: 2, text: "hello" });
  });
});

describe("what has no times is not given an invented order", () => {
  test("a call transcribed before the times were kept has no turns: it stays one block per person", () => {
    const built = pipeline.buildAttributedTranscript({
      names: NAMES,
      parts: [part("caller", 1), part("callee", 1)],
      rows: [row("caller", 1, "everything the caller said", null), row("callee", 1, "everything the callee said", undefined)],
    });
    expect(built.timed).toBe(false);
    expect(built.turns).toEqual([]);
    // The two blocks are exactly what they were.
    expect(built.sides.map((s) => s.text)).toEqual(["[en] everything the caller said", "[en] everything the callee said"]);
    expect(built.text).toBe("Caller (Joel Efala):\n[en] everything the caller said\n\nCallee (JBS Praxis):\n[en] everything the callee said");
  });

  test("times that are not usable are no times", () => {
    const built = pipeline.buildTurns({ names: NAMES, parts: [part("caller", 1)], rows: [row("caller", 1, "hello", "{not json")] });
    expect(built).toEqual({ timed: false, turns: [] });
  });

  test("one part without times, in a call that has them, is one turn where the part began, marked inexact", () => {
    const { timed, turns } = pipeline.buildTurns({
      names: NAMES,
      parts: [part("caller", 1, 120), part("caller", 2, 120), part("callee", 1, 120)],
      rows: [
        row("caller", 1, "first", [seg(3, 4, "first")]),
        row("caller", 2, "the whole second part, from the fallback provider", null),
        row("callee", 1, "reply", [seg(60, 62, "reply")]),
      ],
    });
    expect(timed).toBe(true);
    expect(turns.map((t) => [t.at_s, t.side, t.exact])).toEqual([[3, "caller", true], [60, "callee", true], [120, "caller", false]]);
  });

  test("a stretch with no transcript is a turn of its own, where it falls", () => {
    const { turns } = pipeline.buildTurns({
      names: NAMES,
      parts: [part("caller", 1, 120), { ...part("caller", 2, 120), transcript_status: "FAILED" }, part("callee", 1, 120)],
      rows: [row("caller", 1, "before", [seg(100, 102, "before")]), row("callee", 1, "reply", [seg(110, 112, "reply")])],
      gaps: [{ side: "caller", from_s: 120, to_s: 240, parts: [2] }],
    });
    expect(turns[turns.length - 1]).toEqual({ side: "caller", name: "Joel Efala", at_s: 120, to_s: 240, gap: true });
  });
});

describe("the attributed transcript carries the conversation beside the two blocks", () => {
  test("both are returned, and the blocks are unchanged by the times", () => {
    const built = pipeline.buildAttributedTranscript({
      names: NAMES,
      parts: [part("caller", 1), part("callee", 1)],
      rows: [
        row("caller", 1, "hello there", [seg(1, 2, "hello there")]),
        row("callee", 1, "hello", [seg(3, 4, "hello")]),
      ],
    });
    expect(built.timed).toBe(true);
    expect(built.turns).toHaveLength(2);
    expect(built.text).toBe("Caller (Joel Efala):\n[en] hello there\n\nCallee (JBS Praxis):\n[en] hello");
  });
});
