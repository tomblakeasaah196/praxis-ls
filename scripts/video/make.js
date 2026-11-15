#!/usr/bin/env node
"use strict";
/**
 * Make a Praxis LS training video (doc/TRAINING_VIDEOS.md).
 *
 *   node scripts/video/make.js <scene> script               print the narration, chapter by chapter, in French and English
 *   node scripts/video/make.js <scene> prepare              the ground a scene films on: branding, company, cast (its `prepare`)
 *   node scripts/video/make.js <scene> narrate              the French voice for every line (cached by text)
 *   node scripts/video/make.js <scene> film [--only=c03s01,c04s02]   record the shots
 *   node scripts/video/make.js <scene> assemble             cards, subtitles, chapters, sound: the MP4 and its two .srt files
 *   node scripts/video/make.js <scene> all                  narrate, film and assemble
 *
 * <scene> is a file in scripts/video/scenes/ (with or without .js). Needs the API running on a
 * development database with the filming tenant (doc/TRAINING_VIDEOS.md §4.1), ffmpeg, Chromium
 * (PRAXIS_CHROMIUM) and the narration's Python (VIDEO_PYTHON, §1).
 *
 *   VIDEO_OUT        where the work and the MP4 go (default: <tmp>/praxis-video/<scene>)
 *   VIDEO_PASSWORD   the password filming gives the people it signs in as (default in ground.js)
 *   VIDEO_PYTHON     a python with scripts/video/requirements.txt installed (default python3)
 *   VIDEO_TENANT     the tenant filmed (default smartls); its look is brand/<tenant>/
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

/**
 * How a name on screen is said. The caption keeps the left, the voice reads the right: initials are
 * spelled out, a capitalised word is read as a word (TEST, not "T E S T"), and LIVE is the adjective.
 */
const SAID = [
  [/«LIVE»/g, "«[LIVE](/lˈIv/)»"],
  [/\bLS\b/g, "L S"],
  [/\bHR\b/g, "H R"],
  [/\bAI\b/g, "A I"],
  [/«FR»/g, "«F R»"],
  [/«([^»]*)»/g, (m, t) => `«${t.replace(/\b[A-Z]{4,}\b/g, (w) => w[0] + w.slice(1).toLowerCase())}»`],
];

/** A line's words as the voice reads them: « » mark English, "|" only splits the subtitle. */
const speechOf = (line) =>
  SAID.reduce((t, [re, to]) => t.replace(re, to), line.speech || line.fr).replace(/\|/g, " ").replace(/\s+/g, " ").trim();

function loadScene(name) {
  const file = path.resolve(__dirname, "scenes", name.endsWith(".js") ? name : `${name}.js`);
  if (!fs.existsSync(file)) throw new Error(`No scene ${file}`);
  return require(file);
}

/** The scene, flattened: every shot with its chapter, every line with an id and its words. */
function planOf(scene) {
  const shots = [];
  scene.chapters.forEach((chapter, ci) => {
    chapter.shots.forEach((shot, si) => {
      const id = `c${String(ci + 1).padStart(2, "0")}s${String(si + 1).padStart(2, "0")}`;
      shots.push({
        ...shot, id, chapter: ci + 1, chapterName: chapter.name, chapterEn: chapter.en,
        lines: shot.lines.map((line, li) => {
          if (!line.fr || !line.en) throw new Error(`${id} line ${li + 1} needs both fr (spoken) and en (subtitle).`);
          return { ...line, id: `${id}l${String(li + 1).padStart(2, "0")}`, speech: speechOf(line) };
        }),
      });
    });
  });
  return { ...scene, shots, chapters: scene.chapters.length };
}

function printScript(plan) {
  let words = 0;
  let chapter = 0;
  for (const shot of plan.shots) {
    if (shot.chapter !== chapter) {
      chapter = shot.chapter;
      console.warn(`\n## ${chapter} · ${shot.chapterName} / ${shot.chapterEn}`);
    }
    const where = shot.kind === "card" ? `${shot.card} card` : `${shot.kind}${shot.as ? `, as ${shot.as}` : ", signed out"}${shot.start ? `, ${shot.start}` : ""}${shot.env === "sandbox" ? ", TEST" : ""}`;
    console.warn(`\n[${shot.id} · ${where}]`);
    for (const l of shot.lines) {
      words += l.speech.replace(/[«»]/g, "").split(/\s+/).length;
      console.warn(`- ${l.fr.replace(/\|/g, "")}\n    ${l.en.replace(/\|/g, "")}`);
    }
  }
  console.warn(`\n${words} French words, about ${(words / 150).toFixed(1)} minutes at 150 words a minute (measure it with the narrate step).`);
}

async function main() {
  const [name, step = "all", ...rest] = process.argv.slice(2);
  if (!name) { console.warn(fs.readFileSync(__filename, "utf8").split("*/")[0]); process.exit(2); }
  const plan = planOf(loadScene(name));
  if (step === "script") return printScript(plan);

  const out = process.env.VIDEO_OUT || path.join(os.tmpdir(), "praxis-video", plan.id);
  if (step === "prepare") {
    if (!plan.prepare) throw new Error(`${plan.id} has no prepare step.`);
    return plan.prepare({ log: console.warn, out });
  }

  const audioDir = path.join(out, "audio");
  const python = process.env.VIDEO_PYTHON || "python3";
  fs.mkdirSync(out, { recursive: true });
  const steps = step === "all" ? ["narrate", "film", "assemble"] : [step];
  process.env.VIDEO_OUT = out;

  if (steps.includes("narrate")) {
    const lines = path.join(out, "lines.json");
    fs.writeFileSync(lines, JSON.stringify({
      voices: { fr: "ff_siwis", en: "bf_emma", ...(plan.voices || {}) }, speed: plan.speed || 0.95,
      lines: plan.shots.flatMap((s) => s.lines.map((l) => ({ id: l.id, speech: l.speech }))),
    }, null, 1));
    execFileSync(python, [path.join(__dirname, "narrate.py"), "speak", lines, audioDir], { stdio: "inherit" });
  }
  const durations = JSON.parse(fs.readFileSync(path.join(audioDir, "durations.json"), "utf8"));
  for (const s of plan.shots) for (const l of s.lines) {
    if (!(l.id in durations)) throw new Error(`No narration for ${l.id}: run the narrate step.`);
    l.duration = durations[l.id];
  }

  if (steps.includes("film")) {
    const { config } = require("../../src/config/env");
    const cast = require("./cast");
    const ground = require("./ground");
    ground.guard();
    const emails = Object.fromEntries(Object.keys(cast.CAST).map((k) => [k, cast.emailOf(k)]));
    const used = [...new Set(plan.shots.map((s) => s.as).filter(Boolean))];
    for (const u of used) if (!emails[u]) throw new Error(`The scene films as "${u}" but the cast has no such person.`);
    // A person the scene shows choosing a password on camera is left as they are.
    const fresh = new Set(plan.fresh || []);
    await ground.ready(used.filter((u) => !fresh.has(u)).map((u) => emails[u]));
    const only = rest.find((a) => a.startsWith("--only="));
    await require("./film").film(plan, out, {
      origin: ground.ORIGIN,
      port: config.PORT,
      password: ground.PASSWORD,
      emailOf: (key) => emails[key],
      only: only ? new Set(only.slice(7).split(",")) : null,
    });
  }

  if (steps.includes("assemble")) {
    const { final, length, chapters } = await require("./assemble").assemble(plan, out, { audioDir, python });
    console.warn(`\n${final}\n${(length / 60).toFixed(1)} minutes, ${chapters.length} chapters`);
  }
}

module.exports = { speechOf, planOf, SAID };

if (require.main === module) main().then(() => process.exit(0), (err) => { console.error(err.stack || err.message); process.exit(1); });
