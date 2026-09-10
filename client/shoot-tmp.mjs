import { chromium } from "playwright";

const OUT = "/tmp/shots";
const BASE = "http://127.0.0.1:4188/public";

const shots = [
  { name: "01-motion-en-light", lang: "en", theme: "light", reduce: false },
  { name: "02-reduced-en-light", lang: "en", theme: "light", reduce: true },
  { name: "03-motion-fr-dark", lang: "fr", theme: "dark", reduce: false },
  { name: "04-reduced-fr-dark", lang: "fr", theme: "dark", reduce: true },
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: s.lang === "fr" ? "fr-FR" : "en-GB",
    reducedMotion: s.reduce ? "reduce" : "no-preference",
    colorScheme: s.theme,
  });
  const page = await ctx.newPage();
  await page.addInitScript(
    ([lang, theme]) => {
      localStorage.setItem("praxis.public.lang", lang);
      localStorage.setItem("praxis.public.theme", theme);
    },
    [s.lang, s.theme],
  );
  await page.goto(BASE, { waitUntil: "networkidle" });
  // Let every band's reveal fire, then let the page settle.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${s.name}.png`, fullPage: true });
  console.log(s.name, "→", (await page.title()).slice(0, 60));
  await ctx.close();
}
await browser.close();
