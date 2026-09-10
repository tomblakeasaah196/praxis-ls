# Public Web Experience — Engineering Guide

**What this is.** The build-ready specification for taking `public-web` from a competent static
site to *an experience*: something a visitor moves through, on a phone or a desktop, and does not
want to leave. Five pull requests, each independently reviewable and shippable, each with its own
scope, acceptance criteria, gates and coverage weight.

**Inputs.** `doc/PUBLIC_WEB_EXPERIENCE_QUESTIONNAIRE.md` — the reality read and all 17 answers. Read
it first; this guide does not repeat its reasoning, it executes it.

**How to use it.**

1. Find your PR's section. It lists every deliverable, numbered, with a coverage weight.
2. Build only that PR's scope. Ambition that belongs to a later PR is a review finding, not a bonus.
3. On completion, **update §3 (Progress Log) and §2 (Coverage Register) in the same PR.** A PR that
   ships code without moving the register is incomplete.
4. Record reservations in §3 as you go. The next PR's engineer reads that column before starting.

---

## 1. Doctrine

### 1.1 The express exception

`public-web` is granted an **express exception from the tenant-application design doctrine**. It is
the public face by which a tenant is judged; it may accept what the ERP rejects.

This is not a licence to be undisciplined. It is a specific, bounded change to three rules:

| Rule | In the ERP | In `public-web` |
| --- | --- | --- |
| Motion budget | 250 ms, everything | **200 ms for input response · 600 ms for entrance and narrative · unbounded for scroll-linked and continuous set pieces on the exemption list** |
| Decorative motion | Forbidden — "motion that carries meaning" only | **Permitted, and expected.** Impression is the job on this surface |
| Payload | Whatever the ERP needs | **128 kB gzip first paint, unchanged.** Heavy work is deferred, capability-gated, and never on the LCP path |

The precedent is in the repo already: `client/scripts/check-motion.mjs` carves out `.landing-*` and
`.login-*` as "the front door … the only place in this product where 'impression' is the job."
This guide extends that carve-out to a whole app and writes the new numbers down.

### 1.2 What still binds, without exception

These are not taste and no PR may trade them away:

1. **`prefers-reduced-motion` renders the settled state** — not a faster animation, not a shorter
   one. Asserted by a gate.
2. **WCAG AA in both themes.** Every text-on-surface pair ≥ 4.5:1 (≥ 3:1 large), every non-text UI
   affordance ≥ 3:1. Asserted by a gate, computed — never eyeballed.
3. **Full keyboard operation.** Every narrative set piece is reachable, operable and escapable
   without a pointer. One `<h1>` per page. Correct landmarks and heading order.
4. **No raw palette colours.** Everything through tokens, or white-labelling breaks.
5. **No `window.confirm` / `alert` / `prompt`.** ESLint error, all three apps.
6. **No camera.** No `getUserMedia`, no tracking WASM, no permission prompt. Settled at Q5.
7. **Nothing invented.** Facts come from the tenant's own data or they are absent. See §1.3 for the
   one place this got more specific.
8. **First paint stays inside 128 kB gzip.** Measured and reported in every PR description.

### 1.3 The generated-imagery guardrail

Generated imagery is permitted in two forms (Q15): **abstract/diagrammatic**, and **photoreal used
as atmosphere**. The line is placement, not the image:

> A photoreal generated asset may never be captioned, captioned-adjacent, or positioned such that a
> reasonable visitor concludes it is a photograph of the tenant's own operations.

Concretely — **forbidden**: inside a case note, a proof band, an entity profile, a leadership block,
or under a place name. **Permitted**: full-bleed atmosphere bands, section grounds, abstract set
pieces. Every asset carries `provenance: "owned" | "licensed" | "generated"` in the manifest
(§4.2), and `check:assets` fails a build where a `generated` asset is used in a forbidden slot.

### 1.4 The one documented rule this work amends

`public-web/src/index.css` and `client/src/index.css` both state that the transport-mode colours are
"fixed hues and never derived from `--primary`". Q14 amends this to **harmonise, keep hue**.

The amendment is narrower than it looks, and the distinction must be preserved in code:

- **Derivation is still forbidden.** A mode colour is never computed from the tenant's primary.
- **Harmonisation is permitted.** The mode's *hue* is an anchor constant (sea green, air blue, road
  orange, rail violet — the values already in the tree). Only its **chroma and lightness** adapt, so
  the four modes sit in the same colour world as the tenant's palette. Hue may move at most **±10°**
  from anchor, which is below the threshold at which a hue reads as a different colour.
- **The ERP does not change.** `client/` calls the same shared function with harmonisation disabled,
  so its Control Tower keeps today's exact values. One engine, two call sites, no divergence by
  accident. If the ERP is ever to harmonise too, it is a flag, not a rewrite.

**PR 1 must update the notes in both `index.css` files** so the two do not contradict each other.
A comment that says "never derived" beside code that harmonises is how the next engineer gets it
wrong.

### 1.5 Text is a design material

Q8: no long static text blocks. This is a build constraint, not a preference, and it is testable:

- **No prose block on any marketing page exceeds 90 words** without being broken by an illustration,
  a diagram, a pull-quote, a data object or a staged reveal.
- Long-form content (an insight article, a policy page) is exempt — a reader who clicked an article
  wants an article.
- Every list of three or more parallel items is a candidate for a diagram, not a `<ul>`. The ESG
  block (§8.4) is the worked example.
- Type itself is animated: staged line reveals, weight/width response on the display face, and
  scroll-linked emphasis. Specified in PR 1 §5.5.

---

## 2. Coverage Register

**Coverage** is the percentage of this guide's specified capability that is built, merged and
passing its gates. The denominator is fixed at **100 points**, distributed below. It does not move:
if scope is added later it displaces points rather than inflating the total, so the number stays
comparable across the programme.

**Rules.** A deliverable counts at **full weight only when it is merged and its gates pass**.
Partial work counts **zero** — half a palette engine is not 3 points, it is an unfinished PR. The
engineer completing a PR updates the *Actual* column and the running total in the same PR.

| PR | Deliverables | Planned | Actual | Running |
| --- | --- | ---: | ---: | ---: |
| **PR 1** — Foundations | Palette engine · depth & light · motion system · typography · gates | **22** | — | — |
| **PR 2** — Data & settings engine | Migrations · settings tabs · assets · announcements · partners · social · entity story | **24** | — | — |
| **PR 3** — Homepage experience | Hero · narrative spine · announcements band · signature set piece · bands | **20** | — | — |
| **PR 4** — Journey pages | Track · services · quote · contact · careers · insights — every page a hero | **18** | — | — |
| **PR 5** — About, proof & polish | About · entities · leadership · partners/credentials · footer & social · final pass | **16** | — | — |
| | **Total** | **100** | **0** | **0%** |

Per-deliverable weights are listed inside each PR section. They sum to the PR's planned total.

---

## 3. Progress Log

**Update this on every PR completion. Never delete a row.** The Reservations column is the channel
by which one PR warns the next; an empty Reservations cell on a non-trivial PR will be read as "not
filled in", not as "nothing to report".

| PR | Status | Merged | Coverage after | Reservations, deviations and notes for later work |
| --- | --- | --- | ---: | --- |
| PR 1 | Not started | — | — | — |
| PR 2 | Not started | — | — | — |
| PR 3 | Not started | — | — | — |
| PR 4 | Not started | — | — | — |
| PR 5 | Not started | — | — | — |

### 3.1 Open items carried into the build

| # | Item | Owner | Blocks |
| --- | --- | --- | --- |
| O-1 | **Announcements engine shape** — read from requirements, not chosen outright. Building the recommended shape: Insights `kind` + pinned flag, plus a separate credentials list. Confirm or correct. | Client | PR 2 §6.4 |
| O-2 | **Third-party logo permission.** AGL, CMA CGM, GIZ, FMA, MAGIL. GIZ (German federal agency) and CMA CGM both operate written-permission regimes; AGL is a competitor in some segments, so "partner" framing must be accurate. Which are cleared, and as *partner* or *client*? | Client | PR 5 §9.4 |
| O-3 | **Logo file format.** Supplied logos are screen-resolution rasters with white backgrounds baked in. Dark-band rendering needs **SVG or transparent PNG @2x**. | Client | PR 5 §9.4 |
| O-4 | **Accreditations not yet supplied** — JCTrans, IATA, FIATA, customs broker licence. Highest-credibility content available and currently absent. | Client | PR 5 §9.4 |
| O-5 | **Warehouse asset defect.** Monitor text is a generation artefact ("Warehouse Managemen", nonsense labels). Crop to the aisle; drop the monitors. | Build | PR 2 §6.3 |
| O-6 | **N9 budget discrepancy.** Brief says JS < 100 kB, gate says 128 kB, tree ships 119.5 kB. Resolved for this programme as **128 kB**, per §1.1. Amend `WEB_BUILD_BRIEF.md` N9 in PR 1 so the two stop disagreeing. | Build | PR 1 §5.6 |
| O-7 | **Binary assets are not in the repo and must not be.** Zero images exist in the tree today; everything goes through `storage.service` and `/media`. Assets arrive by upload, not by commit. See §4. | Build | PR 2 §6.3 |
| O-8 | **Photograph provenance unconfirmed.** The four atmosphere images are triaged as `generated`/`licensed`. If any is Smart Logistics' own photography it is `owned` and may be used as evidence rather than atmosphere, which materially raises what the proof band and case notes can do. | Client | PR 2 §6.3 |

---

## 4. Asset Register

### 4.1 Why no binaries are committed

The repository contains **zero** image files. That is deliberate: `src/services/storage.service.js`
(S3 or local, `publicUrl()`, `assertSafeKey()`) is the single path for tenant media, served from
`/media`. Committing third-party trademarks such as CMA CGM's or GIZ's into git would be worse on
both licensing and repository weight than the mechanism that already exists.

**Therefore:** the repo carries a **manifest** naming every expected asset, its slot, its
constraints and its provenance. The binaries are uploaded through the settings surface built in
PR 2. Smart Logistics is seeded; every tenant after uploads their own.

### 4.2 The manifest

Created in PR 1 at `public-web/src/assets/manifest.ts`, validated by `check:assets`:

```ts
export type AssetProvenance = "owned" | "licensed" | "generated";
export type AssetSlot =
  | "hero-atmosphere" | "band-atmosphere" | "service-cover"
  | "leadership-portrait" | "entity-cover" | "partner-mark" | "credential-mark";

export type AssetSpec = {
  key: string;               // storage key, e.g. "site/hero/atmosphere-01"
  slot: AssetSlot;
  provenance: AssetProvenance;
  maxBytes: number;          // enforced by check:assets
  minWidth: number;
  aspect: `${number}:${number}`;
  alt: { fr: string; en: string } | null;  // null ONLY for decorative
};
```

**The rule `check:assets` enforces:** a spec with `provenance: "generated"` may not occupy
`leadership-portrait`, `entity-cover`, `service-cover` or any slot rendered inside a case note or
proof band. Atmosphere slots accept any provenance.

### 4.3 Supplied assets, triaged

| Asset | Provenance | Slot | Verdict |
| --- | --- | --- | --- |
| CEO portrait — Timothée MASSOMBA | `owned` | `leadership-portrait` | **Use at full weight.** Real, well lit, the world-map ground already reads as the business. The anchor of the About page. |
| Offshore rigs on heavy-lift vessel | `generated` / `licensed` | `band-atmosphere` | **Strongest of the four.** Unmistakably project cargo; ties directly to MAGIL and FMA. |
| Humanitarian air cargo, desert apron | `generated` / `licensed` | `band-atmosphere` | **Strong.** Matches the NGO/development positioning and GIZ. Atmosphere only — never captioned as an operation. |
| Multimodal composite (plane/ship/trucks) | `generated` / `licensed` | `band-atmosphere` | **Usable but weak.** The most-used stock composition in freight marketing, and it carries a foreign HUD ("ETA 14:25", network arcs) that fights our design language. If used: graded to the tenant palette, scrimmed, and our own live overlay replacing theirs. |
| Warehouse with WMS monitors | `generated` | `band-atmosphere` | **Crop required (O-5).** Monitor text is a generation artefact and a systems buyer will read those screens. Crop to the aisle — forklifts and racking. The left two-thirds is good. |
| AGL · CMA CGM · GIZ · FMA · MAGIL | third-party | `partner-mark` | **Blocked on O-2 and O-3** — permission, and SVG/transparent PNG. |

**Provenance for the four photographs must be confirmed (O-8).** If any is Smart Logistics' own
photography it is `owned` and may be used as evidence rather than atmosphere, which materially
raises what the proof band and case notes can do.

---

## 5. PR 1 — Foundations · 22 points

**Title:** `feat(public-web): spatial design system — palette engine, depth, motion, typography`

**Goal.** Build the system the other four PRs compose. Nothing here redesigns a page. This PR is
close to invisible in a screenshot and is the reason PRs 3–5 are possible at all.

**Blast radius.** `packages/shared`, `public-web/`, and a *no-op* touch to `client/` (§1.4). Review
should expect the `client/` diff to change no rendered value.

### 5.1 The palette engine · 6 points

**Where.** `packages/shared/design/palette.js` + `palette.d.ts`, exported from
`packages/shared/index.js`.

**Why there and not in `public-web/src/lib/theme.ts`.** Three consumers must agree on the same
palette from the same input: the **API** (which persists and validates it), the **ERP settings
preview** (which must show the tenant exactly what the site will look like before they save), and
**`public-web`** (which paints it). The repository rule is explicit — validation and shared shape
live in `packages/shared`, never re-declared per side. A palette computed twice is a palette that
diverges, and it diverges in the one place a tenant will notice: the preview lying to them.

`public-web/src/lib/theme.ts` keeps its job — *applying* tokens to `:root`. It stops deriving them.

**Input contract.**

```ts
export type PaletteInput = {
  primary: string;            // hex, required
  secondary?: string | null;  // hex
  tertiary?: string | null;   // hex
  harmoniseModes?: boolean;   // default true; client/ passes false (§1.4)
};
```

**Colour space.** All derivation happens in **OKLCH**, hand-written, no dependency (sRGB ⇄ linear
⇄ OKLab ⇄ OKLCH is roughly 80 lines). OKLCH because lightness is perceptually uniform there: a
contrast walk in HSL overshoots badly on saturated oranges and blues, which is exactly the tenant
palette we have.

**Derivations, each with its rule:**

| Output | Rule |
| --- | --- |
| `primary.{50…950}` | Fixed L targets, chroma tapered toward the extremes (a 950 that keeps full chroma reads purple-black, not brand-black). |
| `primaryInk` per theme | Walk L from the brand colour toward black (light) or white (dark) until contrast vs **that theme's card surface** ≥ 4.5:1. Hue and chroma held. This is the existing `theme.ts` behaviour, moved and generalised. |
| `onPrimary` | Carbon or white, whichever clears 4.5:1 on the primary **fill**. If neither does, adjust the *fill's* L until carbon clears. Never ship a fill whose label fails. |
| `secondary`, `tertiary` | If supplied, normalised into the palette (chroma clamped into range, L snapped to the ramp). **If absent, derived:** analogous at **+32°** and **−32°** from primary, chroma matched. This is the single rule that makes any one-colour tenant look deliberate. |
| Surfaces (`background`, `card`, `muted`, `secondary` grounds) | Neutral ramp **tinted toward the primary hue** at chroma 0.006–0.012. Untinted greys beside a saturated brand read as a different design; this is the cheapest thing that makes a page feel like one object. |
| `border`, `input`, `ring` | Derived from surface L with fixed deltas; `ring` is `primaryInk` at the theme's focus alpha. |
| Status (`ok`, `warn`, `bad`, `info`) | **Not brand-derived** — a status that shares the accent's hue stops reading as a status. Hues held at today's values; only L adapted to the theme. Text/fill split preserved. |
| Modes (`sea`, `air`, `road`, `rail`) | Anchors held at today's hues (sea green, air blue, road orange, rail violet). Chroma and L adapted to the tenant palette; **hue clamped ±10°**. Skipped entirely when `harmoniseModes: false`. |

**Output contract.** `{ light: Record<TokenName, string>, dark: Record<TokenName, string> }` — plain
CSS colour strings, plus the raw `R G B` triplets for the tokens consumed as
`rgb(var(--x) / <alpha>)`. The triplet/string split already exists in `theme.ts` and must be
preserved; `--brand-orange` is a bare triplet and `background: var(--brand-orange)` silently drops
the declaration, which has already caused an invisible icon tile in this tree.

**Tests — this is where the points are.** `packages/shared/design/palette.test.js`:

1. **Contrast matrix.** For each of **8 palettes** × **2 themes**, assert every text-on-surface pair
   clears AA. Minimum pairs: foreground/background, foreground/card, mutedForeground/card,
   mutedForeground/muted, primaryInk/card, primaryInk/background, onPrimary/primary,
   secondaryForeground/secondary, each status text on its own fill tint, each mode on card.
2. **The 8 palettes must include hostile ones**: a single near-white primary; a single near-black
   primary; a fully desaturated primary; two colours 6° apart (near-identical); a neon primary at
   maximum chroma; plus Smart Logistics (orange + blue) and Praxis (orange + slate).
3. **Determinism.** Same input → byte-identical output. No `Math.random`, no `Date`.
4. **Hue clamp.** Harmonised modes never exceed ±10° from anchor, across all 8 palettes.
5. **No-op path.** `harmoniseModes: false` returns today's exact mode triplets, asserted against the
   literal values in `client/src/index.css`. This test is what stops the ERP shifting.

### 5.2 Mode harmonisation and the doctrine notes · 2 points

- Wire `harmoniseModes` through: `public-web` → `true`, `client/` → `false`.
- **Rewrite the mode-colour comment in both `index.css` files** to state the amended rule (§1.4):
  anchors are constant, chroma and lightness harmonise, hue moves at most ±10°, derivation from
  `--primary` remains forbidden. Cross-reference this guide's §1.4 by name.
- Rewrite the note in `public-web/src/lib/service-identity.ts` that currently says the mode palette
  is "an identity palette, not a taxonomy". From PR 4 it becomes semantic where the tenant supplies
  a mode, positional otherwise — so the note must describe both paths, not the old one.

### 5.3 Depth and light · 4 points

**A stated light source.** One direction for the whole site: **top-left, 60° elevation.** Every
shadow, every gradient, every bevel and every emissive edge derives from it. The reason to write it
down is that "make it feel richer" otherwise becomes a shadow typed into a component, which is the
failure `index.css` already names.

**Elevation scale.** Replace ad-hoc `--shadow-s/m/l` with a six-step scale; keep the old names as
aliases so nothing breaks:

| Level | Use | Composition |
| --- | --- | --- |
| `--elev-0` | Flush with the ground | No shadow; border only |
| `--elev-1` | Resting card | Contact shadow + 1px light-catch top border |
| `--elev-2` | Hovered card, sticky header | Contact + ambient |
| `--elev-3` | Popover, floating panel | Contact + ambient + spread |
| `--elev-4` | Modal, hero plate | Long ambient, low opacity |
| `--elev-5` | Set-piece foreground | Long ambient + emissive rim |

Each level defines **contact shadow** (tight, dark, opaque), **ambient shadow** (wide, soft) and a
**light-catch** hairline on the surface's lit edge. Two shadows plus a light edge is what reads as a
physical object; one blurred shadow is what reads as a web page. Values differ per theme — on dark
grounds shadows do almost nothing and the light-catch does the work.

**Material tokens:** `--mat-matte`, `--mat-glass` (with a `backdrop-filter` fallback for browsers
without it — the fallback is a solid tint, never a transparent surface with unreadable text over
it), `--mat-scrim`, `--mat-emissive`.

**Reduced-motion and low-power:** elevation is static; nothing here animates by itself.

### 5.4 The motion system · 4 points

**Budgets** (per §1.1), and they are gated:

- **Input response ≤ 200 ms.** Hover, press, focus, toggle. Responsiveness is a different job from
  choreography and must never feel choreographed.
- **Entrance and narrative ≤ 600 ms.** Reveals, staged text, band transitions.
- **Unbounded, by exemption only.** Scroll-linked scrubs and continuous ambient set pieces. Every
  exemption is a named selector in the gate's allow-list with a written reason. An empty reason
  fails the gate.

**Easing set** (tokens, not literals): `--ease-standard` (existing `cubic-bezier(.2,0,.13,1)`),
`--ease-decelerate` for entrances, `--ease-accelerate` for exits, `--ease-emphasis` for the one
overshoot allowed on a set piece.

**Primitives**, all built on the existing single `IntersectionObserver` in
`public-web/src/components/ui/reveal.tsx` — do not add a second observer:

| Hook | Contract |
| --- | --- |
| `useScrollScrub(ref, {start, end})` | Returns `0…1` progress for an element's travel through the viewport. `requestAnimationFrame`-throttled, reads layout once per frame, writes only CSS custom properties (never React state — a scrub through state re-renders 60 times a second). Returns a static `0` under reduced motion. |
| `usePointerLight(ref)` | Writes `--lx` / `--ly` (0…1) from pointer position within the element. **This is the "gaze" mechanism** (Q5): on a desktop the cursor *is* attention. Idles to centre after 2 s of no movement. Disabled on coarse pointers. |
| `useTilt(ref, {max})` | Gyroscope parallax on mobile via `deviceorientation`, pointer parallax on desktop. Writes the same `--lx`/`--ly` contract so a component consumes one interface. **Requires no permission on Android Chrome;** iOS 13+ needs `DeviceOrientationEvent.requestPermission()`, which is a *user gesture* — so it is offered as an explicit opt-in affordance on the set piece, never requested on load. No tilt is a designed state, not a broken one. |
| `useProximity(ref, {radius})` | Distance from pointer to element, `0…1`. For elements that respond as attention *approaches* rather than on hover. |
| `Reveal` (extended) | Gains `direction` (`up`/`down`/`left`/`right`/`scale`), `stagger` for children, and keeps unobserve-on-fire. Never re-animates. |

**The gate:** `public-web/scripts/check-motion.mjs`, modelled on `client/`'s. It asserts the three
budgets, the exemption allow-list with reasons, and — non-negotiably — that the reduced-motion
umbrella still exists, still covers `animation` *and* `transition`, and still reaches
pseudo-elements. Wired as `npm run check:motion` and into `npm run ci`.

### 5.5 Typography · 3 points

**(a) Add one display face.** Amend `doc/BRAND_GUIDELINES.md` and the `check-fonts.mjs` allow-list.
Requirements: variable, a wide weight axis (for the scroll-linked weight response in §1.5),
`latin` + `latin-ext` subsets so French accents render, self-hosted via `@fontsource`, and **≤ 25 kB
gzip for the subset actually shipped**. Headlines only — body stays Inter, figures stay JetBrains
Mono.

**(b) A font registry.** `packages/shared/design/fonts.js` — the curated list the PR 2 picker reads.
Each entry: id, display name, role (`display` | `body` | `mono`), the exact stack string, and the
subset. **The picker is a closed list, never a free text field** — a tenant typing "Comic Sans" must
not be able to name a family that `check-fonts.mjs` forbids, and a stack that doesn't end in a bare
generic keyword fails that gate.

**(c) Use the ramp that already exists.** The scale goes to 72 px (`jumbo`) and the site never
exceeds 44. Establish and document: display sizes for heroes, real optical-size adjustment via the
variable axis, `font-variant-numeric: tabular-nums` on every figure that sits in a column, and
tighter tracking as size increases (already in the config — it is simply unused).

**(d) The text-as-material primitives** (§1.5): `<StagedLines>` (line-by-line reveal, splitting on
render, never on a timer), `<WeightScrub>` (display weight responds to scroll progress),
`<PullQuote>`, `<FigureCallout>`. These are what let PRs 3–5 honour the 90-word rule.

**(e) Font audit.** 454.5 kB gzip across 18 files is more than three families need. Report the
weights actually *set* by any selector, drop the rest, and put the new number in the PR description.

### 5.6 Gates, budgets and documentation · 3 points

- **Port `check:palette` and `check:contrast`** from `client/scripts/` to `public-web`. Contrast runs
  against the **engine's computed output**, not a static token file — that is the only version of
  the check that is true for every tenant rather than for the default one.
- **New: `check:assets`** — validates `manifest.ts` (§4.2): every spec's byte budget, the
  provenance/slot rule from §1.3, and that every non-decorative asset has bilingual `alt`.
- **New: `check:motion`** (§5.4).
- **Deferred-chunk budget.** `check-bundle.mjs` gains a second assertion: any chunk not on the
  first-paint path is reported, and the **sum of deferred chunks reachable from the homepage** has a
  budget of **220 kB gzip**. This is what keeps a WebGL set piece honest instead of unbounded.
- **Per-sequence asset budget.** A frame sequence (Q16) has a hard cap of **180 kB gzip total** and
  **24 frames**; video atmosphere caps at **150 kB**. Enforced by `check:assets`.
- **Amend `WEB_BUILD_BRIEF.md` N9** to 128 kB with a note pointing at §1.1 (O-6). Two documents
  disagreeing about the budget is how a build ends up over both.
- **Write `public-web/README.md` §Experience** — the short version of §1 for someone who opens this
  app and wonders why its rules differ from the ERP's.

### 5.7 PR 1 acceptance criteria

- [ ] `npm run ci` green from repo root.
- [ ] `public-web`: `lint`, `typecheck`, `test`, `check:bundle`, `check:i18n`, `check:motion`,
      `check:palette`, `check:contrast`, `check:assets` all green.
- [ ] `packages/shared`: palette engine tests green, including all 8 palettes × 2 themes.
- [ ] `client/` renders **byte-identical** mode colours to `main` — proven by the §5.1 test 5, and
      by a screenshot of the Control Tower before/after in the PR description.
- [ ] First-paint number reported in the PR description. **Expected to move very little** — the
      engine is ~2 kB and replaces existing derivation code.
- [ ] Font total reported before and after the audit.
- [ ] Both `index.css` doctrine notes rewritten (§5.2).
- [ ] Coverage Register and Progress Log updated in this PR.

**Weights:** 5.1 = 6 · 5.2 = 2 · 5.3 = 4 · 5.4 = 4 · 5.5 = 3 · 5.6 = 3 → **22**

---

## 6. PR 2 — Data & settings engine · 24 points

**Title:** `feat(site): website experience settings — palette, type, assets, announcements, partners, social`

**Goal.** Everything the public site renders becomes **parametric** — seeded for Smart Logistics,
editable by any tenant, replaceable without a deploy. This PR builds no marketing page. It builds
the machine that feeds them, so PRs 3–5 render real content instead of placeholders.

**Blast radius.** `migrations/tenant/`, `migrations/seeds/`, `src/modules/site/`,
`src/modules/content/`, `src/modules/master/corporate_entity/`, `client/src/features/settings/`,
`public-web/src/lib/`. Large, but almost entirely additive.

**Migration numbering.** The tree's highest is `13779`. Start at **`13780`** and keep them
contiguous; `scripts/db/check-migration-numbers.js` gates this, and the migrator keys on filename
so a renumber after merge re-runs a migration. Every migration in this PR is additive — new tables
and nullable columns only — so no down-migration is required, matching the tree's convention.

### 6.1 Schema · 4 points

| Migration | Table / change | Notes |
| --- | --- | --- |
| `13780_site_theme.sql` | `site_theme` — one row per tenant: `primary`, `secondary`, `tertiary`, `font_display_id`, `font_body_id`, `font_mono_id`, `radius`, `default_mode` (`light`/`dark`), `updated_at`, `updated_by` | The palette engine's **input**, never its output. Storing derived tokens would freeze a tenant's palette against future engine improvements and give us two sources of truth. |
| `13781_site_asset.sql` | `site_asset` — `key` (storage key), `slot`, `provenance`, `alt_fr`, `alt_en`, `width`, `height`, `bytes`, `sort`, `active` | Mirrors `manifest.ts` (§4.2). `provenance` is `NOT NULL` — an asset whose origin nobody recorded is one nobody can safely place. |
| `13782_site_partner.sql` | `site_partner` — `name`, `kind` (`carrier` \| `client` \| `network`), `logo_key`, `url`, `sort`, `active`, `permission_note` | `permission_note` is deliberate: O-2 is a recurring question, and the answer belongs beside the logo, not in someone's inbox. |
| `13783_site_credential.sql` | `site_credential` — `name`, `issuer`, `identifier`, `issued_on`, `expires_on`, `logo_key`, `url`, `sort`, `active` | Certifications and licences. Separate from partners because a certification is **earned**, is dated, can expire, and is the most persuasive content on a forwarder's site. |
| `13784_site_social_link.sql` | `site_social_link` — `platform` (enum), `url`, `sort`, `active` | §6.6. |
| `13785_insight_kind_and_pin.sql` | `insight` gains `kind` (`article` \| `announcement`, default `article`) and `pinned_until` (nullable timestamptz) | O-1. Reuses the whole existing CMS rather than building a second one. |
| `13786_entity_public_story.sql` | `corporate_entity` gains a public-story block: `public_enabled`, `public_summary_{fr,en}`, `public_coverage` (jsonb — countries and corridors), `public_focus` (jsonb — service lines), `public_cover_key` | Q11: addresses, locations, coverage areas and service focus are the essential facts. |
| `13787_site_leader.sql` | `site_leader` — `entity_id` (nullable ⇒ group-level), `name`, `role_{fr,en}`, `bio_{fr,en}`, `photo_key`, `linkedin_url`, `sort`, `active` | Nullable `entity_id` is what gives Q13 its two tiers in one table: group leadership and per-entity leadership, one renderer, one editor. |
| `13788_site_about.sql` | `site_about` — the group-level About: `mission_{fr,en}`, `vision_{fr,en}`, `principles` (jsonb), `esg` (jsonb: three pillars × bullet lists), `founded_year`, `hq`, `timeline` (jsonb) | The "global About" of Q13, editable in settings. Per-entity story lives on the entity (`13786`). |

**Shared schemas.** Every one of these gets its Zod schema in `packages/shared/schemas/site-*.js`,
consumed by **both** the validator and the settings form. Do not re-declare a rule on one side —
`check:schemas` treats a `*.validator.js` importing `@praxis/shared` as a migrated adapter and will
redden a file you only added one line to.

### 6.2 Palette and typography settings · 4 points

**Where.** `client/src/features/settings/website-theme.tsx`, reached from the existing `website-nav`
— this section already exists (`website-pages`, `website-insights`, `website-card`), so this is an
extension, not a new module.

**What it does.**

1. **Three colour inputs** — primary (required), secondary, tertiary. Each: a swatch, a hex field, an
   eyedropper where supported.
2. **Live derived palette.** Calls the *same* `packages/shared` engine `public-web` calls, and
   renders the full derived ramp — surfaces, inks, states, harmonised modes — in **both themes side
   by side**. The tenant sees exactly what the site will be.
3. **Contrast verdict, visible.** Every derived pair shows its measured ratio and a pass/fail. Where
   the engine has corrected a colour (an ink step-down, an `onPrimary` flip to carbon), the UI
   **says so in words** — "your orange fails as text on white at 3.1:1, so text uses #C74600 at
   4.9:1". A tenant who understands the correction stops fighting it.
4. **Font pickers** — three closed dropdowns (display, body, mono) from the §5.5(b) registry, with a
   live specimen. Never a free text field.
5. **Radius and default theme.**
6. **Preview surface** — a miniature of the real hero, a card, and a button, painted with the derived
   tokens. Not a swatch grid: a tenant judges a palette on a composition, never on squares.

**RBAC.** `MOD-70` (branding), action **`edit`** — the backend spells it `edit`, never `update`.

### 6.3 Asset library · 3 points

**Where.** `client/src/features/settings/website-assets.tsx`.

- Upload to `storage.service` (S3 or local, `assertSafeKey`), served from `/media`. Follow
  `branding.uploadLogo` and the per-entity logo upload for the size-cap and MIME allow-list pattern.
- Per-slot upload with the slot's constraints **shown before** the file dialog opens — aspect,
  minimum width, byte cap. A tenant who learns the constraint after a rejected upload uploads
  something wrong twice.
- **`provenance` is a required field on upload**, with the §1.3 rule stated inline. The server
  refuses a `generated` asset for a restricted slot; the UI disables those slots rather than
  failing after the fact.
- Bilingual `alt` required for every non-decorative asset (N10, `check:i18n`).
- Server-side derivatives on upload: AVIF + WebP, at 3 widths, `srcset` emitted by the renderer.
  This is where the page budget is won or lost.
- **O-5: the warehouse asset ships cropped** to the aisle. Do the crop at seed time and record the
  original's defect in the seed comment, so nobody re-uploads the uncropped version later.

### 6.4 Announcements · 3 points

Per O-1, building the recommended shape — **confirm before starting**.

- `insight.kind = 'announcement'` plus `pinned_until`. Reuses `content/insight`, `insight_public`,
  the existing editor and the existing detail route wholesale.
- Settings: `website-insights.tsx` gains a kind filter and a pin control. A pinned announcement
  shows its expiry inline — an announcement that silently outlives its relevance is worse than none.
- Public read: `insight_public` gains `?kind=` and a `pinned` collection. **Cap the pinned
  collection at 5** server-side. Q7 said "only for the very important announcements"; a cap is how
  that survives contact with a tenant who pins everything.
- The homepage band that renders these is **PR 3 §7.4**.

### 6.5 Partners, clients and credentials · 3 points

- Settings: `website-partners.tsx` — two lists, `partner` and `credential`, each sortable, each with
  logo upload, each with `active`.
- **`kind` is a required choice on a partner**, and the UI explains the difference in one line each:
  *carrier* = we move cargo on these lines · *client* = these organisations trust us · *network* =
  we are a member. They make different claims and must not share a row (§9.4).
- **`permission_note` is required before `active` can be set true.** Free text — "written clearance,
  email from X, 12 Mar 2026" or "logo used under network membership terms". This is O-2 made
  structural rather than remembered.
- Credentials carry `issued_on` / `expires_on`; an expired credential auto-deactivates and the
  settings list surfaces it in a warning state.

### 6.6 Social links · 2 points

**A closed registry, pasted URLs, empty stays empty.**

- `packages/shared/design/social.js` — the seeded platform registry: `linkedin`, `facebook`,
  `instagram`, `youtube`, `x`, `tiktok`, `whatsapp`, `telegram`. Each carries an id, a display
  name, an icon id in our own glyph set, and a **host pattern**.
- Settings: `website-social.tsx` — every registered platform rendered as one row with a single URL
  field. Paste a URL, it appears; leave it blank, it does not exist. No add/remove flow, no ordering
  UI beyond the registry's own order. This is the simplest thing that meets the requirement and it
  has no empty state to design.
- **Validation, and it is not pedantry:** the pasted URL must be `https:` and its host must match the
  platform's pattern. A "LinkedIn" icon in a tenant's footer linking anywhere at all is a phishing
  primitive on the tenant's own domain. The Zod rule lives in `packages/shared` so the form and the
  API refuse the same strings.
- **Icons are drawn in our own set** (`public-web/src/components/ui/icons.tsx`), monochrome,
  `currentColor`. No third-party icon font, no brand SVGs pulled from a CDN — the CSP and the
  payload budget both forbid it, and a monochrome glyph is what the footer wants anyway.
- Rendering in the footer is **PR 5 §9.5**.

### 6.7 Group About and leadership · 3 points

**The two-tier model (Q13), which is the advice you asked for.** There is no "group" record in the
data model — `corporate_entity` has `parent_entity_id`, so a group *could* be the root entity, but
inferring the group from a tree that a tenant may not have populated is how an About page comes up
empty. So:

- **The group About is a singleton** (`site_about`, `13788`), edited in settings. It owns mission,
  vision, principles, ESG, founding year, HQ and the timeline. It is *the company's story*.
- **Each entity's About is concise and factual** (`13786`, on the entity), edited in the Entity 360
  (§6.8). It owns what that legal company does, where, its coverage and its service focus.
- **Leadership is one table with a nullable `entity_id`** (`13787`). `NULL` ⇒ group leadership;
  set ⇒ that entity's leadership. One editor, one renderer, both tiers.

That split is the one that stays correct: a group's mission does not belong to a subsidiary, and a
subsidiary's coverage does not belong to the group.

- Settings: `website-about.tsx` (group story + timeline + ESG) and `website-leaders.tsx` (both
  tiers, with an entity filter).
- **Portrait uploads are `owned` provenance only.** The §1.3 rule already forbids `generated` in
  `leadership-portrait`; the UI must not offer the option.

### 6.8 Corporate Entity 360 — public story tab · 2 points

- A new tab in the existing entity dossier UI, writing the `13786` columns.
- **It opens pre-filled from what the system already knows** (Q11): legal name, trading name,
  country, registered address, incorporation date, and the entity's service lines. The tenant edits
  prose; they do not retype facts that exist.
- **Statutory identifiers are excluded from the public payload.** RCCM and NIU stay internal per the
  §7 recommendation in the questionnaire — they are verifiable elsewhere, add nothing for a visitor,
  and are the raw material for impersonating the tenant. A `/legal` page can carry them later if
  asked; the public endpoint must not.
- A `public_enabled` switch per entity, default **off**. An entity becomes public deliberately.

### 6.9 Public read endpoints · 3 points

All under `/public/site`, all `feature: "website"`-gated, all pinned to the **live** schema
(`req.tenantDbIn("live", …)`) so `X-Praxis-Env` cannot select sandbox from the internet — the rule
`site_public.routes.js` already follows. All rate-limited on the existing `makeLimiter` pattern.

| Endpoint | Returns |
| --- | --- |
| `GET /public/site/theme` | The palette **input** plus the engine's derived output, so the client paints without recomputing on a cold CPU. Cache-Control set; this is on the LCP path. |
| `GET /public/site/announcements` | Pinned collection (max 5) and the full list, paginated. |
| `GET /public/site/partners` | Active partners by kind, and credentials. Never `permission_note`. |
| `GET /public/site/social` | Active social links only. |
| `GET /public/site/about` | Group About + group leadership. |
| `GET /public/site/entities` | Public-enabled entities: name, trading name, country, address, coverage, focus, cover asset, and that entity's leadership. **No RCCM, no NIU, no cap table, no governance.** |

**A test per endpoint asserting the redaction.** Not "the controller omits it" — an assertion on the
serialised response body that the statutory and governance fields are absent. Redaction that is
only a `SELECT` list is redaction one refactor away from leaking.

### 6.10 Seeds · 2 points

`migrations/seeds/9087_seed_smartls_experience.sql` — Smart Logistics, seeded so the site is
complete on first load and every value is editable afterwards.

- **Theme:** primary `#FF5A00`, secondary `#1884C4` (the mark's blue), tertiary derived.
- **Group About:** the supplied copy, refined per §8.4 — corporate, concise, and structured for the
  ESG interactive rather than as prose.
- **Leadership:** Timothée MASSOMBA, Chief Executive Officer, with the CEO message and portrait slot.
- **Entity:** Smart Logistics & Services Ltd — founded 2021, Douala, CEMAC focus, coverage and
  service lines populated.
- **Assets:** manifest rows for the four atmosphere images and the portrait, with `provenance` set
  per §4.3 and the warehouse crop applied.
- **Partners and credentials:** rows created **inactive**, with `permission_note` empty, pending O-2.
  Seeded-but-inactive is honest; seeded-and-live would publish marks we have no clearance for.
- **Social:** platform rows seeded, URLs empty.

### 6.11 PR 2 acceptance criteria

- [ ] `npm run ci` green. `check:schemas` green — every new rule in `packages/shared`, used by both
      sides, no validator re-declaring a shape.
- [ ] `check-migration-numbers.js` green; migrations contiguous from 13780.
- [ ] `node scripts/generate-api-docs.js` run and its output committed. New endpoints and any new
      `AppError` change counts in `doc/API_REFERENCE.md` and `doc/ERROR_CODES.md`, and stale
      generated docs redden `build-test`.
- [ ] Redaction test per public endpoint (§6.9).
- [ ] Social URL host validation tested, including the rejection cases.
- [ ] Seed runs clean on an empty tenant and is idempotent.
- [ ] `npx jest` across the **whole** backend — a shared validator or repo helper touched here
      breaks suites this PR never names.
- [ ] Coverage Register and Progress Log updated.

**Weights:** 6.1 = 4 · 6.2 = 4 · 6.3 = 2 · 6.4 = 2 · 6.5 = 2 · 6.6 = 2 · 6.7 = 3 · 6.8 = 1 ·
6.9 = 3 · 6.10 = 1 → **24**

---

## 7. PR 3 — Homepage experience · 20 points

**Title:** `feat(public-web): the homepage journey — hero, narrative spine, announcements, set piece`

**Goal.** The front door. This is where "wow" lands and where the signature set piece lives.

**The spine (Q8: A + C).** The existing band order is already roughly a journey and its persuasion
logic is sound — lookup → services → how-we-work → proof → CTA, because far more visitors are
checking something that exists than shopping for something new. **Do not reorder it.** Make the
journey explicit *within* it: each band is a stage of one shipment moving from origin to delivery,
and the scroll is the movement.

### 7.1 Hero · 5 points

- **Depth rungs 2 + 4** (CSS 3D + canvas), budget-clean, no deferred chunk. The hero is the LCP
  element and nothing on the LCP path may wait for a lazy import.
- The tenant photograph (or atmosphere asset) sits at depth, under the **§5.3 light model**, with
  `usePointerLight` driving both the scrim's falloff and the type's light-catch. On mobile,
  `useTilt` drives the same contract from the gyroscope.
- **The two-layer scrim survives, with its measured opacities intact.** The floors in
  `hero.tsx` were derived against a worst-case near-white upload — headline α ≥ 0.48, sub-line
  ≥ 0.82, **eyebrow ≥ 0.87, which binds**. Any new treatment re-derives them or keeps them.
- The route network becomes a **live canvas**: nodes, lanes and cargo moving along them, drawn in the
  harmonised mode colours. Hand-written, ≤ 6 kB, `requestAnimationFrame`, paused when off-screen
  (`IntersectionObserver`) and under reduced motion.
- **The track widget keeps the hero's best real estate.** That audience arithmetic is correct and is
  not up for redesign. It gains material and depth, not demotion.
- Headline uses `<StagedLines>` + `<WeightScrub>` (§5.5d).

### 7.2 Announcements band · 2 points

- Directly beneath the hero (Q17: "around the hero section", "more than important").
- Renders the pinned collection (max 5, §6.4). **Absent when empty** — no "no announcements" state.
- Treatment: a horizontally-moving band that is *not* a naive marquee — it pauses on hover and on
  focus, is fully keyboard-navigable, respects reduced motion by becoming a static list, and never
  traps a screen reader in a loop. `aria-live="off"`; it is not urgent, it is ambient.
- "View more" → the announcements list (PR 4 §8.6).

### 7.3 Services band · 2 points

- Depth rung 2: real `perspective` + `preserve-3d`, cards responding to pointer proximity, lit from
  the §5.3 source, mode-coloured per §5.2.
- Orange (the tenant primary) remains **the only thing that looks clickable**. Mode colours are
  identity — top bar, tile, panel — never a button, a link or an arrow. That rule predates this work
  and survives it.

### 7.4 How-we-work, proof and portal bands · 3 points

- How-we-work becomes the journey's middle: a scroll-scrubbed sequence of stages, each with a
  drawn diagram, honouring the 90-word rule (§1.5).
- Proof band renders real case notes where they exist and **renders nothing where they do not**
  (N12). The current "Nothing published yet" is the honest state and stays until content exists.
- Portal band keeps its deliberate overlap (`--py-band` arithmetic — do not fork the clamp).

### 7.5 The signature set piece · 6 points

**The corridor network scene.** The one place WebGL is justified: the trade lanes the company
actually runs, in space, that you can move through.

- **Deferred and capability-gated.** Loads after LCP, only when: `navigator.connection.effectiveType`
  is `4g` or absent, `deviceMemory` ≥ 4 (or absent), pointer is fine **or** touch with gyro, and
  `prefers-reduced-motion` is not set. Fails to the §7.5b baseline silently.
- **Budget: within the 220 kB deferred-chunk allowance (§5.6).** Report the real number.
- **(b) The baseline is a designed state, not a fallback.** An SVG/canvas corridor map at rung 3–4,
  complete and beautiful on its own. A visitor who never gets the WebGL scene must not be able to
  tell something is missing. **Build the baseline first** — a set piece whose fallback was built
  second is always a fallback that looks like one.
- Data comes from `listCorridors` (already in the tree) and the §6.9 entities endpoint. **If corridor
  data is thin, the scene is abstract by design** — it must never imply lanes the tenant does not run.
- Keyboard: every node reachable, focus visible, `Escape` exits the scene's focus trap.
- iOS gyro permission is offered as an explicit affordance inside the scene, never on load (§5.4).

### 7.6 Quote and contact bands · 2 points

Raised onto the PR 1 system. The primary CTA commits to **"Request a quote"** as *the* conversion,
with tracking as *the* service — the Q8 answer, made visible in hierarchy.

### 7.7 PR 3 acceptance criteria

- [ ] All PR 1 gates green, plus `check:assets` and the deferred-chunk budget.
- [ ] **First paint ≤ 128 kB gzip**, reported. Deferred total for the homepage reported separately.
- [ ] Lighthouse ≥ 95 on all four categories, mobile profile, **EN and FR**, numbers in the PR.
- [ ] Real-device check on a mid-range Android over throttled 4G — a Lighthouse score is not this.
- [ ] Reduced-motion screenshots of every band in the PR description.
- [ ] Full keyboard pass on the hero and the set piece, recorded.
- [ ] The set piece's baseline reviewed **on its own**, WebGL disabled.
- [ ] Coverage Register and Progress Log updated.

**Weights:** 7.1 = 5 · 7.2 = 2 · 7.3 = 2 · 7.4 = 3 · 7.5 = 6 · 7.6 = 2 → **20**

---

## 8. PR 4 — Journey pages · 18 points

**Title:** `feat(public-web): every page an entrance — track, services, quote, contact, careers, insights`

**Goal.** Q4: *every page gets a hero or animated header.* No route ships as a bare `<h1>` on white.

### 8.1 The track result page · 5 points

**The most-visited screen on the site and today the least designed.** A visitor is handed a
beautiful door that opens onto a plain room.

- **Ergonomics over spectacle.** This page is opened on a phone, on data, by someone who wants one
  fact: where is my cargo. Depth rungs 1 + 3 only — no deferred chunk, no WebGL, no frame sequence.
- The timeline becomes a spatial object: stages at real elevations (§5.3), the completed path lit,
  the current stage emissive, the future dimmed. Mode colour carries the leg.
- **The one fact first.** Status and ETA above everything, at display size, before the timeline.
- Empty, not-found and error states designed to the same standard. A wrong reference is the most
  common outcome on this page and it currently gets the least design.

### 8.2 Services index and detail · 3 points

- Index: an animated header, then the mode-lit grid at rung 2.
- Detail: a per-service entrance using the service's own cover asset and mode identity.
- **Mode becomes semantic here where the tenant supplies it** (§5.2), positional where they do not.
  The `service-identity.ts` note must describe both paths.

### 8.3 Quote and the wizard · 3 points

- An entrance that does not delay the form — the CTA of the whole site lands here.
- `quote-wizard` gains staged transitions between steps, real progress depth, and a settled state
  under reduced motion. **Never animate a field into place under a cursor.**
- The existing draft autosave must not regress; that defect (a save landing after a discard) is
  named in `CLAUDE.md` and is the reason native dialogs are banned.

### 8.4 The ESG interactive · 3 points

**The worked example of §1.5.** The supplied ESG copy is three columns of bullets — the single
most text-heavy block in the programme, and the one Q12 named specifically.

- Three pillars — Environment, Social, Governance — as a **scroll-scrubbed triptych**, each pillar a
  drawn illustration that assembles as it enters, its bullets revealing as annotations on the
  drawing rather than as a list beside it.
- Under reduced motion it renders as a clean, static, three-column layout with the drawings settled.
  That state must be genuinely good; it is what a meaningful share of readers will see.
- Content from `site_about.esg` (§6.1), so a tenant edits it without a deploy.

### 8.5 Contact and careers · 2 points

- Entrances; contact gains the office/coverage map (fed by §6.9 entities).
- Careers keeps its form's ergonomics — a job applicant on a phone is not an audience to experiment on.

### 8.6 Insights and announcements list · 2 points

- Index gains an entrance and a kind filter (article / announcement).
- Article pages: editorial typography, a reading-progress affordance, and **long-form is exempt from
  the 90-word rule** (§1.5) — a reader who clicked an article wants an article.

### 8.7 PR 4 acceptance criteria

- [ ] Every route in `router.tsx` has a designed entrance. Enumerate them in the PR description with
      a screenshot each, **light and dark**.
- [ ] Track page tested on a real mid-range Android over throttled 4G, with a timing.
- [ ] All gates green; first paint reported; Lighthouse ≥ 95 both languages.
- [ ] Reduced-motion pass on the ESG interactive specifically — it is the most complex settled state
      in the programme.
- [ ] FR typography verified per `BRAND_GLOSSARY_FR_EN.md` §5 — narrow NBSP before `: ; ! ?`,
      guillemets, accented capitals, `1 250 000,50 XAF`, `15 %`, `20 août 2026`.
- [ ] Coverage Register and Progress Log updated.

**Weights:** 8.1 = 5 · 8.2 = 3 · 8.3 = 3 · 8.4 = 3 · 8.5 = 2 · 8.6 = 2 → **18**

---

## 9. PR 5 — About, proof and polish · 16 points

**Title:** `feat(public-web): about, corporate entities, partners and the final pass`

### 9.1 The About page · 4 points

- New route, and **`About` into the header nav and the footer** — it is absent from both today.
- Structure, from §6.7's two tiers: the group story (mission, vision, principles, timeline, ESG)
  then the entities.
- The CEO message is the page's anchor — real portrait, real signature, at full weight. It is the
  single most credible asset in the programme.
- The timeline is scroll-scrubbed: **time as depth**. Founded 2021, first licence, entity
  formations, corridor openings — whatever `site_about.timeline` carries.

### 9.2 Corporate entities, drawn as a network · 4 points

**Q13, option B — the map-first structure.** Entities placed geographically, connected by the
corridors they run, so the group structure and the service network are **the same picture**. Reuses
PR 3's corridor scene rather than inventing a second spatial idea.

- Per entity: trading name, country, registered address, coverage areas, service focus, cover asset,
  and that entity's leadership. **No RCCM, no NIU** (§6.8).
- An org-chart fallback for reduced motion and for narrow screens — and it must be clean, not a
  squashed map.

### 9.3 Leadership · 2 points

- Group and per-entity tiers from one renderer (§6.7).
- **Portraits are `owned` provenance only** — the guardrail is structural (§1.3), not a convention.
- Card: portrait, name, role, LinkedIn where supplied, expandable bio. Hover/focus response at rung
  1–2. Restrained: this is the page where dignity beats effects.

### 9.4 Partners, clients and credentials · 3 points

**Three claims, three treatments. Never one grey grid.**

| Kind | Claim | Treatment |
| --- | --- | --- |
| Carrier / network | "We move cargo on these lines" | Placed **on the corridor map** — the mark sits at the lane it serves |
| Client | "These organisations trust us" | A quiet monochrome band, colour on hover/focus. **Never** a "Trusted by" headline (N11) |
| Credential | "We are accredited, and here is the number" | A dated strip with issuer and identifier — the most persuasive content on the page |

- **Gated on O-2 and O-3.** Any partner without a `permission_note` stays inactive and does not
  render. Any logo without SVG/transparent PNG does not render — a white rectangle on a dark band is
  worse than an absent logo.
- If O-2 is unresolved at build time, **ship the section with credentials only** and leave the
  partner rows inactive. That is a complete section, not a broken one.

### 9.5 Footer and social · 1 point

- Rendered from §6.6: registered platforms with a URL appear, blank ones do not exist. Monochrome
  glyphs from our own set, `currentColor`, accessible names per platform, `rel="noopener noreferrer"`.
- Footer gains About, the credentials line, and the legal entity line.

### 9.6 The final pass · 2 points

- **Cross-page audit:** one light model, one motion vocabulary, one type rhythm across all routes.
- Full a11y sweep, both themes, keyboard and screen reader.
- Both languages, end to end, read by a human.
- **Coverage reaches 100%** or the Progress Log states exactly what is outstanding and why.

### 9.7 PR 5 acceptance criteria

- [ ] All gates green; first paint and deferred totals reported.
- [ ] Lighthouse ≥ 95, all four, both languages, mobile.
- [ ] Entity endpoint redaction re-verified against the rendered page — no statutory identifier
      reaches the DOM.
- [ ] Every partner rendered has a `permission_note`. Asserted by a test, not by inspection.
- [ ] Social links: host validation verified; a blank platform renders nothing.
- [ ] Coverage Register at **100%**, Progress Log complete.

**Weights:** 9.1 = 4 · 9.2 = 4 · 9.3 = 2 · 9.4 = 3 · 9.5 = 1 · 9.6 = 2 → **16**

---

## 10. Conventions for every PR

**Before you push:** `npm run ci` from the repo root — not `npm run lint && npx jest`. That is two
of thirty-odd gates. `npm run ci --fast` stops at the first failure; `--frontend` / `--backend`
narrow it. Read `scripts/ci-local.js`'s header for what it **skips** (live Postgres, PgBouncer, the
Docker build, the Playwright layout gate), so a green local run is "the gates that need no
infrastructure pass" and not a promise.

**The two that catch people:**

1. **Generated artefacts drift.** `doc/API_REFERENCE.md` and `doc/ERROR_CODES.md` are generated. One
   new `AppError` changes a count and reddens `build-test`. Never edit them — run
   `node scripts/generate-api-docs.js` and commit what it writes.
2. **Cross-cutting gates fire from files you did not open.** `check:schemas` treats any
   `*.validator.js` importing `@praxis/shared` as a migrated adapter — adding that import to a
   validator that still declares its own shape turns a green file red.

**And the older trap:** CI's `build-test` runs `npx jest` across the **entire** backend. A change to
a shared service, repo helper or validator breaks suites a targeted `jest <file>` never ran. A subset
pass is not evidence.

**Every PR description carries:** the first-paint number, the deferred total where relevant,
Lighthouse figures for both languages, reduced-motion screenshots, and the coverage delta.

**PR titles** start with a Conventional Commits prefix — CI gates on it because the changelog is
written from the title.

**RBAC action is `edit`**, never `update`.

---

## 11. Definition of done for the programme

The programme is complete when **Coverage reads 100%** and:

- Every route has a designed entrance, in both themes, in both languages.
- First paint is inside 128 kB gzip and Lighthouse is ≥ 95 on all four categories, mobile, EN and FR.
- Every value a tenant sees is parametric — seeded for Smart Logistics, editable without a deploy.
- Reduced motion renders a complete, designed, settled site.
- Nothing on the site asserts a fact the tenant's own data does not carry.
