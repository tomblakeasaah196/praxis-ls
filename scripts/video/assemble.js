"use strict";
/**
 * Put a filmed video together (doc/TRAINING_VIDEOS.md §5): each shot becomes a segment (its picture,
 * 1920 × 960, over its caption bar, 1920 × 120), the segments are joined, and the narration is laid on
 * the same clock, set to -16 LUFS. The bar carries the English subtitle of the French line being
 * spoken. The MP4 carries the chapters, the title and "JBS Praxis" as its artist, and its audio is
 * tagged French; beside it go the two transcripts as .srt files (English and French), for a
 * platform that wants a subtitle track of its own.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const style = require("./style");
const cards = require("./cards");
const { GAP, LEAD, TAIL } = require("./film");

const FPS = 30;
const ffmpeg = (args) => execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });

/** A caption longer than this is shown in two halves, split at "|" or at the comma nearest its middle. */
const CAPTION_MAX = 84;

function captionParts(say) {
  const text = say.trim();
  if (text.includes("|")) return text.split("|").map((p) => p.trim()).filter(Boolean);
  if (text.length <= CAPTION_MAX) return [text];
  // Split where the sentence rests: a full stop beats a colon, a colon beats a comma, and whichever
  // is nearest the middle wins; with none, at the space nearest the middle.
  const mid = text.length / 2;
  let best = null;
  for (const m of text.matchAll(/([.!?]|[:;]|,) /g)) {
    const cost = Math.abs(m.index - mid) - (/[.!?]/.test(m[1]) ? 14 : m[1] === "," ? 0 : 7);
    if (!best || cost < best.cost) best = { cost, at: m.index + 1 };
  }
  if (!best) {
    const at = text.lastIndexOf(" ", mid);
    return [text.slice(0, at), text.slice(at + 1)];
  }
  return [text.slice(0, best.at), text.slice(best.at + 1)];
}

/** Where a card shot's lines fall, since nothing is filmed for it. */
function cardTake(shot) {
  let t = LEAD;
  const lines = shot.lines.map((l, i) => {
    const at = t;
    t += l.duration + (l.hold || 0) + (i < shot.lines.length - 1 ? GAP : TAIL);
    return { id: l.id, at };
  });
  return { start: 0, end: t + (shot.extra || 0), lines, frames: [] };
}

function takeOf(shot, out) {
  if (shot.kind === "card") return cardTake(shot);
  const f = path.join(out, "shots", shot.id, "take.json");
  if (!fs.existsSync(f)) throw new Error(`${shot.id} has not been filmed: run the film step (doc/TRAINING_VIDEOS.md §4.4).`);
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

/** An ffconcat list holding each image for its time, from `from` to `to` (seconds on the take's clock). */
function concatList(file, items, from, to) {
  const rows = ["ffconcat version 1.0"];
  for (let i = 0; i < items.length; i++) {
    const a = i === 0 ? from : items[i].t;
    const b = i + 1 < items.length ? items[i + 1].t : to;
    if (b - a <= 0) continue;
    rows.push(`file '${items[i].file}'`, `duration ${(b - a).toFixed(4)}`);
  }
  rows.push(`file '${items[items.length - 1].file}'`);
  fs.writeFileSync(file, rows.join("\n") + "\n");
}

/** 00:01:02,500 */
function stamp(sec) {
  const t = Math.max(0, sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms === 1000 ? 999 : ms, 3)}`;
}

async function assemble(plan, out, { audioDir, python }) {
  const work = path.join(out, "work");
  fs.mkdirSync(work, { recursive: true });
  const shooter = await cards.open();
  const segments = [];
  const clips = [];
  const chapters = [];
  const subtitles = { en: [], fr: [] };
  let offset = 0;
  try {
    const opening = await shooter.shoot(style.card({ ...plan.opening }), path.join(work, "opening.png"), style.SIZE.picture);
    const closing = await shooter.shoot(style.card({ ...plan.closing, closing: true }), path.join(work, "closing.png"), style.SIZE.picture);
    const rim = await shooter.shoot(style.phoneRim(), path.join(work, "phone-rim.png"), style.SIZE.picture);
    const barCache = new Map();
    const barOf = async (shot, caption) => {
      const key = `${shot.chapter}|${caption}`;
      if (!barCache.has(key))
        barCache.set(key, await shooter.shoot(
          style.bar({ number: shot.chapter, total: plan.chapters, chapter: shot.chapterName, chapterEn: shot.chapterEn, caption }),
          path.join(work, `bar-${String(barCache.size + 1).padStart(4, "0")}.png`), style.SIZE.bar));
      return barCache.get(key);
    };

    for (const [k, shot] of plan.shots.entries()) {
      const take = takeOf(shot, out);
      const length = take.end - take.start;
      if (!chapters.length || chapters[chapters.length - 1].number !== shot.chapter)
        chapters.push({ number: shot.chapter, title: `${shot.chapterName} / ${shot.chapterEn}`, start: offset });

      // The caption bar: each line's English subtitle (or its halves, by length) from when it is spoken until the next.
      const bars = [];
      for (const [i, line] of take.lines.entries()) {
        const spec = shot.lines.find((l) => l.id === line.id);
        const parts = captionParts(spec.en);
        const total = parts.reduce((n, p) => n + p.length, 0);
        let at = line.at - take.start;
        for (const p of parts) {
          const span = (spec.duration * p.length) / total;
          bars.push({ file: await barOf(shot, p), t: i === 0 && bars.length === 0 ? 0 : at });
          subtitles.en.push({ from: offset + at, to: offset + at + span, text: p });
          at += span;
        }
        subtitles.fr.push({ from: offset + (line.at - take.start), to: offset + (line.at - take.start) + spec.duration, text: spec.fr.replace(/\|/g, " ") });
        clips.push({ file: path.join(audioDir, `${line.id}.wav`), at: offset + (line.at - take.start) });
      }
      const barList = path.join(work, `bars-${shot.id}.txt`);
      concatList(barList, bars, 0, length);

      // The picture.
      const seg = path.join(work, `seg-${String(k + 1).padStart(3, "0")}.mp4`);
      const enc = ["-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-t", length.toFixed(3), seg];
      if (shot.kind === "card") {
        const still = shot.card === "closing" ? closing : opening;
        ffmpeg(["-loop", "1", "-framerate", String(FPS), "-i", still, "-f", "concat", "-safe", "0", "-i", barList,
          "-filter_complex", `[1:v]fps=${FPS},scale=1920:120[b];[0:v][b]vstack=inputs=2,format=yuv420p[v]`, "-map", "[v]", ...enc]);
      } else {
        const shotDir = path.join(out, "shots", shot.id);
        const frames = take.frames.map((f) => ({ file: path.join(shotDir, f.file), t: f.t - take.start }));
        const frameList = path.join(work, `frames-${shot.id}.txt`);
        concatList(frameList, frames, 0, length);
        if (shot.kind === "phone") {
          const ground = await shooter.shoot(style.phoneGround(shot.label), path.join(work, `ground-${shot.id}.png`), style.SIZE.picture);
          const s = style.PHONE.screen;
          ffmpeg(["-loop", "1", "-framerate", String(FPS), "-i", ground, "-f", "concat", "-safe", "0", "-i", frameList,
            "-loop", "1", "-framerate", String(FPS), "-i", rim, "-f", "concat", "-safe", "0", "-i", barList,
            "-filter_complex", `[1:v]fps=${FPS},scale=${s.width}:${s.height}:flags=lanczos[p];[0:v][p]overlay=${s.x}:${s.y}[g];[g][2:v]overlay=0:0[pic];[3:v]fps=${FPS},scale=1920:120[b];[pic][b]vstack=inputs=2,format=yuv420p[v]`,
            "-map", "[v]", ...enc]);
        } else {
          ffmpeg(["-f", "concat", "-safe", "0", "-i", frameList, "-f", "concat", "-safe", "0", "-i", barList,
            "-filter_complex", `[0:v]fps=${FPS},scale=1920:960:flags=lanczos[pic];[1:v]fps=${FPS},scale=1920:120[b];[pic][b]vstack=inputs=2,format=yuv420p[v]`,
            "-map", "[v]", ...enc]);
        }
      }
      segments.push(seg);
      offset += length;
      console.warn(`segment ${shot.id}: ${length.toFixed(1)}s (to ${offset.toFixed(1)}s)`);
    }
  } finally {
    await shooter.close();
  }

  // The narration on one track, the segments joined, then the finished file.
  const timeline = path.join(work, "timeline.json");
  fs.writeFileSync(timeline, JSON.stringify({ length: offset, clips }, null, 1));
  const voice = path.join(work, "narration.wav");
  execFileSync(python, [path.join(__dirname, "narrate.py"), "mix", timeline, voice], { stdio: "inherit" });
  const segList = path.join(work, "segments.txt");
  fs.writeFileSync(segList, "ffconcat version 1.0\n" + segments.map((s) => `file '${s}'`).join("\n") + "\n");
  const meta = path.join(work, "meta.txt");
  const ms = (s) => Math.round(s * 1000);
  fs.writeFileSync(meta, [";FFMETADATA1", `title=${plan.meta.title}`, `artist=${plan.meta.artist || "JBS Praxis"}`, `language=fra`,
    ...chapters.flatMap((c, i) => ["[CHAPTER]", "TIMEBASE=1/1000", `START=${ms(c.start)}`,
      `END=${ms(i + 1 < chapters.length ? chapters[i + 1].start : offset)}`, `title=${c.title}`])].join("\n") + "\n");
  const final = path.join(out, `${plan.file}.mp4`);
  ffmpeg(["-f", "concat", "-safe", "0", "-i", segList, "-i", voice, "-i", meta, "-map", "0:v", "-map", "1:a", "-map_metadata", "2", "-map_chapters", "2",
    "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p", "-r", String(FPS), "-movflags", "+faststart",
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000", "-ac", "1", "-c:a", "aac", "-b:a", "160k", "-metadata:s:a:0", "language=fra",
    "-t", offset.toFixed(3), final]);

  for (const lang of ["en", "fr"]) {
    const rows = subtitles[lang].map((c, i) => `${i + 1}\n${stamp(c.from)} --> ${stamp(c.to)}\n${c.text}\n`);
    fs.writeFileSync(path.join(out, `${plan.file}.${lang}.srt`), rows.join("\n"));
  }
  return { final, length: offset, chapters };
}

module.exports = { assemble, captionParts, cardTake, stamp };
