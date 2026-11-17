/**
 * The call recorder (calls audit A3): every part is a complete file.
 *
 * The fake MediaRecorder behaves like the real one where it matters: started
 * without a timeslice it delivers ONE blob when stopped, and that blob begins
 * with the container header. Started with a timeslice it delivers the header
 * in its first chunk only, which is how the old recorder's parts 2..N ended up
 * undecodable. The browser-level proof (each part decoded on its own) is
 * client/e2e/call-recorder.spec.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CallRecorder,
  pickMimeType,
  PART_TARGET_MS,
  RECORDER_BITS_PER_SECOND,
  MAX_PART_BYTES,
  MAX_RETARGETS,
  type RecorderPart,
} from "./call-recorder";

const HEADER = [0x1a, 0x45, 0xdf, 0xa3];
const log: string[] = [];

class FakeMediaRecorder {
  static isTypeSupported = (t: string) => t.startsWith("audio/webm");
  static made: FakeMediaRecorder[] = [];
  static payload = 64;
  state = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  timeslice: number | undefined;
  readonly n: number;
  constructor(public stream: unknown, public opts: Record<string, unknown> = {}) {
    FakeMediaRecorder.made.push(this);
    this.n = FakeMediaRecorder.made.length;
  }
  start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = "recording";
    log.push(`start ${this.n}`);
  }
  stop() {
    this.state = "inactive";
    log.push(`stop ${this.n}`);
    // Asynchronously, like a browser: the data, then the stop event.
    queueMicrotask(() => {
      const bytes = new Uint8Array(HEADER.length + FakeMediaRecorder.payload);
      bytes.fill(this.n);
      bytes.set(HEADER, 0);
      this.ondataavailable?.({ data: new Blob([bytes], { type: "audio/webm;codecs=opus" }) });
      this.onstop?.();
    });
  }
}

class FakeTrack {
  static clones: FakeTrack[] = [];
  applyConstraints = vi.fn(async () => {});
  stop = vi.fn();
  clone() {
    const t = new FakeTrack();
    FakeTrack.clones.push(t);
    return t;
  }
}
const micTrack = new FakeTrack();
const micStream = { getAudioTracks: () => [micTrack] } as unknown as MediaStream;

let clock = 0;
function makeRecorder(over: { onPart?: (p: RecorderPart) => Promise<void> | void } = {}) {
  const parts: RecorderPart[] = [];
  const lost: number[] = [];
  const onPart = vi.fn(over.onPart ?? (async (p: RecorderPart) => { parts.push(p); }));
  const rec = new CallRecorder({
    callId: "c1",
    side: "caller",
    language: "fr",
    deps: { onPart, onLost: (i) => lost.push(i), now: () => clock },
  });
  return { rec, parts, lost, onPart };
}

function firstBytes(blob: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve([...new Uint8Array(reader.result as ArrayBuffer)].slice(0, 4));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob.slice(0, 4));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  log.length = 0;
  FakeMediaRecorder.made = [];
  FakeMediaRecorder.payload = 64;
  FakeTrack.clones = [];
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("MediaStream", class {
    constructor(public tracks: unknown[]) {}
    getAudioTracks() {
      return this.tracks;
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("every part is a complete file (A3)", () => {
  it("one MediaRecorder per part, started with no timeslice, so each part carries its own header", async () => {
    const { rec, parts } = makeRecorder();
    await rec.arm(micStream);
    clock = PART_TARGET_MS;
    await vi.advanceTimersByTimeAsync(PART_TARGET_MS);
    clock = PART_TARGET_MS * 2;
    await vi.advanceTimersByTimeAsync(PART_TARGET_MS);
    clock = PART_TARGET_MS * 2 + 37_000;
    const out = await rec.finish();

    expect(FakeMediaRecorder.made).toHaveLength(3);
    expect(FakeMediaRecorder.made.every((m) => m.timeslice === undefined)).toBe(true);
    expect(out).toEqual({ parts: 3, lost: 0 });
    expect(parts.map((p) => p.index)).toEqual([1, 2, 3]);
    vi.useRealTimers(); // jsdom's FileReader runs on timers
    for (const p of parts) expect(await firstBytes(p.blob)).toEqual(HEADER);
    // Each part is exactly one recorder's output, never a slice of another's.
    expect(parts.map((p) => p.blob.size)).toEqual([68, 68, 68]);
  });

  it("the next recorder starts before the previous one stops, so no audio falls between parts", async () => {
    const { rec } = makeRecorder();
    await rec.arm(micStream);
    await vi.advanceTimersByTimeAsync(PART_TARGET_MS);
    expect(log).toEqual(["start 1", "start 2", "stop 1"]);
    await rec.finish();
  });

  it("a part's duration is measured, not assumed", async () => {
    const { rec, parts } = makeRecorder();
    clock = 1_000;
    await rec.arm(micStream);
    clock = 1_000 + PART_TARGET_MS + 850; // a throttled background timer
    await vi.advanceTimersByTimeAsync(PART_TARGET_MS);
    clock += 12_345;
    await rec.finish();
    expect(parts.map((p) => p.durationMs)).toEqual([PART_TARGET_MS + 850, 12_345]);
  });

  it("mono Opus at 32 kbps, from the recorder's own clone of the microphone", async () => {
    const { rec } = makeRecorder();
    await rec.arm(micStream);
    expect(RECORDER_BITS_PER_SECOND).toBe(32_000);
    expect(FakeMediaRecorder.made[0].opts).toEqual({ mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32_000 });
    expect(FakeTrack.clones).toHaveLength(1);
    expect(FakeTrack.clones[0].applyConstraints).toHaveBeenCalledWith({ channelCount: 1 });
    expect(micTrack.applyConstraints).not.toHaveBeenCalled();
    await rec.finish();
    // Its own track stops; the call's microphone is not the recorder's to stop.
    expect(FakeTrack.clones[0].stop).toHaveBeenCalled();
    expect(micTrack.stop).not.toHaveBeenCalled();
  });
});

describe("the recorder on a live call", () => {
  it("hands nothing over until a part closes, and never touches the network itself", async () => {
    const { rec, onPart } = makeRecorder();
    await rec.arm(micStream);
    await vi.advanceTimersByTimeAsync(PART_TARGET_MS - 1);
    expect(onPart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onPart).toHaveBeenCalledTimes(1);
    await rec.finish();
  });

  it("a part too large to upload is counted as lost, and still takes its number", async () => {
    FakeMediaRecorder.payload = MAX_PART_BYTES + 1;
    const { rec, parts, lost } = makeRecorder();
    await rec.arm(micStream);
    await vi.advanceTimersByTimeAsync(PART_TARGET_MS);
    FakeMediaRecorder.payload = 64;
    const out = await rec.finish();
    expect(lost).toEqual([1]);
    expect(parts.map((p) => p.index)).toEqual([2]);
    expect(out).toEqual({ parts: 2, lost: 1 });
  });

  it("a part the outbox could not take is counted, and the parts after it still go", async () => {
    let first = true;
    const kept: number[] = [];
    const { rec, lost } = makeRecorder({
      onPart: async (p) => {
        if (first) {
          first = false;
          throw new Error("storage refused");
        }
        kept.push(p.index);
      },
    });
    await rec.arm(micStream);
    await vi.advanceTimersByTimeAsync(PART_TARGET_MS);
    const out = await rec.finish();
    expect(lost).toEqual([1]);
    expect(kept).toEqual([2]);
    expect(out.lost).toBe(1);
  });

  it("finish is safe to call twice, and after it nothing more is recorded", async () => {
    const { rec } = makeRecorder();
    await rec.arm(micStream);
    const a = await rec.finish();
    const b = await rec.finish();
    expect(a).toEqual(b);
    await vi.advanceTimersByTimeAsync(PART_TARGET_MS * 3);
    expect(FakeMediaRecorder.made).toHaveLength(1);
  });

  it("a browser without MediaRecorder rejects arm; the caller declares zero parts", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const { rec } = makeRecorder();
    await expect(rec.arm(micStream)).rejects.toThrow("no-media-recorder");
    expect(await rec.finish()).toEqual({ parts: 0, lost: 0 });
  });

  it("prefers WebM/Opus when the browser has it", () => {
    expect(pickMimeType()).toBe("audio/webm;codecs=opus");
  });
});

/* ── The call moved to another microphone (Speaker / Earpiece on a phone) ── */

describe("the recorder follows the call to another microphone", () => {
  /** A second microphone: its own track, its own clones. */
  function otherMic() {
    const track = new FakeTrack();
    return { track, stream: { getAudioTracks: () => [track] } as unknown as MediaStream };
  }
  const tracksOf = (m: FakeMediaRecorder) => (m.stream as { tracks: unknown[] }).tracks;

  it("starts the next part on a clone of the new microphone before the old recorder stops", async () => {
    const { rec } = makeRecorder();
    await rec.arm(micStream);
    const oldClone = FakeTrack.clones[0];
    const next = otherMic();
    log.length = 0;

    expect(await rec.retarget(next.stream)).toBe(true);

    expect(log).toEqual(["start 2", "stop 1"]);
    const newClone = FakeTrack.clones[1];
    expect(tracksOf(FakeMediaRecorder.made[0])).toEqual([oldClone]);
    expect(tracksOf(FakeMediaRecorder.made[1])).toEqual([newClone]);
    // The recorder's own clone again, asked for mono; the call's track is left alone.
    expect(newClone.applyConstraints).toHaveBeenCalledWith({ channelCount: 1 });
    expect(next.track.applyConstraints).not.toHaveBeenCalled();
    expect(rec.isRecording).toBe(true);
    await rec.finish();
  });

  it("the part that closes at the move is a whole file, and the numbering has no gap", async () => {
    const { rec, parts } = makeRecorder();
    await rec.arm(micStream);
    clock = 45_000;
    await rec.retarget(otherMic().stream);
    clock = 45_000 + 20_000;
    const out = await rec.finish();

    expect(out).toEqual({ parts: 2, lost: 0 });
    expect(parts.map((p) => p.index)).toEqual([1, 2]);
    expect(parts.map((p) => p.durationMs)).toEqual([45_000, 20_000]);
    vi.useRealTimers(); // jsdom's FileReader runs on timers
    for (const p of parts) expect(await firstBytes(p.blob)).toEqual(HEADER);
  });

  it("releases the old microphone's clone once its part is delivered, and never the call's own tracks", async () => {
    const { rec } = makeRecorder();
    await rec.arm(micStream);
    const oldClone = FakeTrack.clones[0];
    const next = otherMic();
    await rec.retarget(next.stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(oldClone.stop).toHaveBeenCalledTimes(1);
    expect(FakeTrack.clones[1].stop).not.toHaveBeenCalled();
    await rec.finish();
    expect(FakeTrack.clones[1].stop).toHaveBeenCalledTimes(1);
    expect(micTrack.stop).not.toHaveBeenCalled();
    expect(next.track.stop).not.toHaveBeenCalled();
  });

  it("the 120 s timer restarts from the move, so the part after it is not cut short", async () => {
    const { rec, onPart } = makeRecorder();
    await rec.arm(micStream);
    await vi.advanceTimersByTimeAsync(PART_TARGET_MS - 10_000);
    await rec.retarget(otherMic().stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(onPart).toHaveBeenCalledTimes(1);
    // The old timer would have fired 10 s after the move.
    await vi.advanceTimersByTimeAsync(PART_TARGET_MS - 1);
    expect(onPart).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(onPart).toHaveBeenCalledTimes(2);
    await rec.finish();
  });

  it("a new microphone that will not record leaves the running recorder on the old one", async () => {
    const { rec, parts } = makeRecorder();
    await rec.arm(micStream);
    const Real = FakeMediaRecorder;
    vi.stubGlobal("MediaRecorder", class extends Real {
      constructor(stream: unknown, opts: Record<string, unknown> = {}) {
        if (Real.made.length >= 1) throw new DOMException("no", "NotSupportedError");
        super(stream, opts);
      }
    });
    expect(await rec.retarget(otherMic().stream)).toBe(false);
    vi.stubGlobal("MediaRecorder", Real);
    expect(rec.isRecording).toBe(true);
    expect(FakeTrack.clones[0].stop).not.toHaveBeenCalled();
    // The clone made for the microphone that could not be recorded is let go.
    expect(FakeTrack.clones[1].stop).toHaveBeenCalledTimes(1);
    const out = await rec.finish();
    expect(out).toEqual({ parts: 1, lost: 0 });
    expect(parts.map((p) => p.index)).toEqual([1]);
  });

  it("does nothing before it is armed and after it has finished", async () => {
    const { rec } = makeRecorder();
    expect(await rec.retarget(otherMic().stream)).toBe(false);
    await rec.arm(micStream);
    await rec.finish();
    expect(await rec.retarget(otherMic().stream)).toBe(false);
    expect(FakeMediaRecorder.made).toHaveLength(1);
  });

  it("stops moving at the budget, so the part count can never pass the server's ceiling", async () => {
    const { rec } = makeRecorder();
    await rec.arm(micStream);
    for (let i = 0; i < MAX_RETARGETS; i += 1) expect(await rec.retarget(otherMic().stream)).toBe(true);
    expect(await rec.retarget(otherMic().stream)).toBe(false);
    const out = await rec.finish();
    // 40 moves + the first part = 41; with the timer's 15 in a 30-minute call
    // that is 56, under the server's 60.
    expect(out.parts).toBe(MAX_RETARGETS + 1);
    expect(MAX_RETARGETS + 1 + 15).toBeLessThanOrEqual(60);
  });
});
