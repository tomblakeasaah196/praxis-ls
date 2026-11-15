"use strict";
/**
 * The training-video tooling (scripts/video/, doc/TRAINING_VIDEOS.md). It films a browser and runs a
 * voice model, neither of which a unit test can do, so this pins what can go wrong on paper: how a
 * line is spoken, how a long subtitle is split, who is in the cast, and that a scene is whole.
 */
const fs = require("node:fs");
const path = require("node:path");

const { speechOf, planOf } = require("../../scripts/video/make");
const { captionParts, stamp } = require("../../scripts/video/assemble");
const { CAST, emailOf } = require("../../scripts/video/cast");

const SCENES = path.join(__dirname, "..", "..", "scripts", "video", "scenes");

describe("how a line is spoken", () => {
  it("spells initials, reads a capitalised word as a word, and gives LIVE its own sound", () => {
    expect(speechOf({ fr: "Chez «Smart LS», appuyez sur «TEST»." })).toBe("Chez «Smart L S», appuyez sur «Test».");
    expect(speechOf({ fr: "Le bouton «LIVE» est vert." })).toContain("«[Live](/lˈIv/)»");
    expect(speechOf({ fr: "Ouvrez «My HR» puis «Praxis AI»." })).toBe("Ouvrez «My H R» puis «Praxis A I».");
  });

  it("leaves French words in capitals alone and drops the subtitle split mark", () => {
    expect(speechOf({ fr: "Une première.|Puis le reste." })).toBe("Une première. Puis le reste.");
    expect(speechOf({ fr: "À voir", speech: "Dit autrement" })).toBe("Dit autrement");
  });
});

describe("the plan of a scene", () => {
  const scene = {
    id: "t",
    chapters: [{ name: "Un", en: "One", shots: [{ kind: "card", card: "opening", lines: [{ fr: "Bonjour.", en: "Hello." }] }] }],
  };

  it("numbers every shot and line, and carries both chapter names", () => {
    const plan = planOf(scene);
    expect(plan.shots[0].id).toBe("c01s01");
    expect(plan.shots[0].lines[0].id).toBe("c01s01l01");
    expect(plan.shots[0].chapterEn).toBe("One");
    expect(plan.chapters).toBe(1);
  });

  it("refuses a line without both languages, so nothing is spoken without its subtitle", () => {
    const bad = { ...scene, chapters: [{ ...scene.chapters[0], shots: [{ kind: "card", card: "opening", lines: [{ fr: "Bonjour." }] }] }] };
    expect(() => planOf(bad)).toThrow(/both fr/);
  });
});

describe("subtitles", () => {
  it("keeps a short caption whole, splits at the mark, and splits a long one at the comma nearest its middle", () => {
    expect(captionParts("Press Sign In.")).toEqual(["Press Sign In."]);
    expect(captionParts("One half.|The other half.")).toEqual(["One half.", "The other half."]);
    const long = "Type your work address in the email field, then press the button that signs you in to the workspace";
    const parts = captionParts(long);
    expect(parts).toHaveLength(2);
    expect(parts.join(" ")).toBe(long);
  });

  it("breaks where the sentence rests, never in the middle of one", () => {
    expect(captionParts("The “FR” button switches the interface to French. For this training we stay in English.")).toEqual([
      "The “FR” button switches the interface to French.",
      "For this training we stay in English.",
    ]);
  });

  it("writes SubRip times", () => {
    expect(stamp(0)).toBe("00:00:00,000");
    expect(stamp(62.5)).toBe("00:01:02,500");
    expect(stamp(3723.0049)).toBe("01:02:03,005");
  });
});

describe("the cast", () => {
  const roles = ["SUPER_ADMIN", "CEO", "MANAGEMENT", "FINANCE", "ACCOUNTANT", "SALES", "OPERATIONS", "WAREHOUSE", "FLEET", "PROCUREMENT", "HR"];

  it("is invented: every address is on the reserved .test domain and is unique", () => {
    const emails = Object.keys(CAST).map(emailOf);
    for (const e of emails) expect(e).toMatch(/^[a-z]+\.[a-z]+@smartls\.test$/);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emailOf("nadege")).toBe("nadege.tchouameni@smartls.test");
  });

  it("gives each person real roles and a manager who is in the cast", () => {
    for (const [key, p] of Object.entries(CAST)) {
      expect(p.roles.length).toBeGreaterThan(0);
      for (const r of p.roles) expect(roles).toContain(r);
      if (p.reports_to) expect(CAST[p.reports_to]).toBeDefined();
      expect(p.reports_to).not.toBe(key);
    }
  });
});

describe("every scene", () => {
  const files = fs.readdirSync(SCENES).filter((f) => f.endsWith(".js"));

  it("has at least one", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s is whole: both languages on every line, English marked in pairs, and no em dash", (file) => {
    const scene = require(path.join(SCENES, file));
    const plan = planOf(scene);
    expect(plan.shots.length).toBeGreaterThan(0);
    const cast = new Set(Object.keys(CAST));
    for (const shot of plan.shots) {
      if (shot.as) expect(cast.has(shot.as)).toBe(true);
      for (const line of shot.lines) {
        // A voice reads « » as English: an unpaired mark would read the rest of the sentence in it.
        expect((line.fr.match(/«/g) || []).length).toBe((line.fr.match(/»/g) || []).length);
        for (const text of [line.fr, line.en]) expect(text).not.toMatch(/[–—]|--/);
        expect(line.fr.split(/\s+/).length).toBeLessThanOrEqual(30);
      }
    }
  });
});
