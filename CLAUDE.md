# CLAUDE.md — working rules for this repository

Read this before writing code. It is short on purpose; the detail lives in
`doc/`, and the pointers below are the ones worth following.

Praxis LS is a **white-label, multi-tenant** logistics and OHADA-accounting ERP.
"White-label" is not a marketing word here — it is the property most of the
frontend rules exist to protect. Every colour, every font and every dialog a
tenant sees is supposed to be *theirs*.

## The frontend rule that trips people up first

**Never use `window.confirm`, `window.alert` or `window.prompt`. Not anywhere,
not temporarily, not "just for now".**

This is enforced by the `praxis/no-native-dialogs` ESLint rule as an **error** in
all three frontend apps (`client/`, `platform-console/`, `public-web/`), so code
that uses one does not merge. The rule catches the aliases too — `window["confirm"]`,
`const { confirm } = window`, and `const ask = window.confirm` are all the same
violation.

Reach for these instead:

| Instead of       | Use                                                                    |
| ---------------- | ---------------------------------------------------------------------- |
| `window.confirm` | `useConfirm()` from `@/components/ui/use-confirm` (or `<ConfirmDialog>`) |
| `window.prompt`  | `usePrompt()` from `@/components/ui/use-prompt` (or a `<Dialog>` with a `<Field>`) |
| `window.alert`   | `<Callout>` for something they are reading, `useToast()` otherwise      |

`useConfirm()` returns an `await`-able call plus the element to render, so the
call site keeps the same top-to-bottom shape the `confirm()` had. Full example
and the copy rules — name the outcome in the title, name the action in the
button, `destructive` for anything irreversible — are in
**`doc/FRONTEND_GUIDE.md` §3.10**.

**Why it is a hard rule and not a preference.** A native dialog is the one piece
of UI a tenant sees that the *browser* draws rather than us. It renders in OS
chrome titled "app.praxis-ls.com says", which discards the tenant's white-label
branding at the exact moment the product is asking them to destroy something. It
has no token colours, so a destructive action cannot look destructive. Its
buttons say "OK" and "Cancel", which never name the action. It cannot be
translated by `tr()`. And `alert`/`confirm` **block the event loop**, which has
already caused a real defect here: a draft autosave landing after a discard.

If you believe you have found the exception, you almost certainly have not.
`eslint-disable-next-line praxis/no-native-dialogs` exists, requires a written
reason next to it, and nothing in the tree needs one today.

## The second frontend rule: dates are day-first

**Never `<input type="date">` or `<input type="datetime-local">`. Use
`<DateField>` / `<DateTimeField>` from `@/components/ui/`.**

This is enforced by `scripts/check-date-format.js` (`npm run check:dates`),
which runs in CI and in `npm run ci`, so a native date input does not merge.

A native date input renders in the **operating system's** locale, and no HTML
attribute overrides it — `lang` is ignored for the value display. On a
US-configured workstation it shows and accepts mm/dd/yyyy. Praxis serves a
corridor that reads dates day-first, so the operator types 03/07 meaning the 3rd
of July and the control stores the 7th of March.

Nothing catches that, which is the entire reason it is a gate. Both readings are
real dates: the value validates, the API accepts it, the round-trip is clean and
every test stays green. It surfaces months later as a licence that expired in a
month nobody expected or a customs deadline missed by a quarter.

`DateField` reads and writes dd/mm/yyyy while storing the ISO `YYYY-MM-DD` the
API already wants, so nothing downstream changes. It takes `min`, `max`,
`required`, and a react-hook-form `{...field}` spread. `DateTimeField` is the
same thing with `HH:mm` on the end. (`type="month"` is fine — no day in it.)

The same rule covers **displaying** a date. `toLocaleDateString()` with no
locale means "whatever this machine is set to" — month-first on a US
workstation, and in a container with no `LANG`, which is how server-rendered
dates were month-first too. Use the formatters in `lib/format.ts` (`dateFmt`,
`dateDmy`, `dateTimeFmt`) or pin `en-GB`; never `undefined`, `[]`, `"en"` or
`"en-US"` for a format that renders a day number.

**ISO `YYYY-MM-DD` is not the bug** — it is the wire format the API contract,
the `@shared` validators and every `date` column are built on, and it stays.
What changes is where a PERSON reads a date: document and PDF templates
(`services/documents/templates` — an invoice prints `27/07/2026`), xlsx/CSV
exports (`services/spreadsheet`), and screens. The gate flags ISO in those two
backend paths and nowhere else.

Three escape hatches, each costing a written reason next to it:
`@date-format:foreign` for an incoming third-party format (a bank statement
genuinely arrives month-first, and refusing to parse it does not make it
day-first), `@date-format:parts` for an `Intl.DateTimeFormat` built only to call
`formatToParts()`, which renders nothing, and `@date-format:filename` for an ISO
day in a filename (`/` is not legal in one, and ISO is what makes downloads
sort). Full detail in
**`doc/FRONTEND_GUIDE.md` §3.12**.

## The third frontend rule: uploads go through the engine

**Never `<input type="file">`. Use `<ImageUpload>` (upload on pick) or
`<FilePicker>` + `<UploadList>` + `useUpload({ autoStart: false })` (upload on
Save), from `@/components/ui/image-upload` and `@/lib/use-upload`.**

Enforced by the `praxis/no-raw-upload` ESLint rule as an **error** in all three
frontend apps, with **no baseline allow-list** — every upload site in the tree is
on the engine. It catches the rewrites too: `<input type={"file"} />` and
`el.type = "file"` after `createElement` are the same violation.

`public-web/` carries its own copy of the engine (`components/ui/file-input.tsx`,
`lib/image-compress.ts`) because that app installs only its own dependencies in
CI and cannot import from `client/`. Keep the two in step.

The engine gives every upload three things, none of them optional: a **preview**
from the moment the picker closes, a **0→100% percentage** ending in an explicit
*Upload complete* once the server has answered, and **compression** before the
bytes leave the device.

A `<FileDrop>` is also gated: `praxis/require-upload-progress` fails one that
passes neither `{...fileDropProps(upload.items[0])}` nor an explicit
`uploadProgress`. That rule exists because the first one did not cover it —
`no-raw-upload` passed the whole tree while fourteen `<FileDrop>`s still showed
a filename and then a tick with no percentage between them.

`profile` is required and is not cosmetic — it decides whether the image is
tonally corrected. `document` and `brand` never are: auto-levelling a customs
scan makes it stop matching the paper, and stretching a logo's histogram hands
the tenant back a different green. `photo` and `avatar` are. Full detail,
including the delivery side (`<ResponsiveImage>`, AVIF/WebP derivatives), is in
**`doc/FRONTEND_GUIDE.md` §3.13**.

**Why it is a hard rule.** `FileDrop` has accepted `uploadProgress` and
`uploadSuccess` props since it was written, and 2 of ~30 upload sites passed
them. Nobody decided those screens should have no progress bar — the raw input
was closer to hand than four pieces of state and a cleanup effect. A bare upload
costs the user a preview (picking the wrong scan is invisible for months), a
percentage (a slow upload is indistinguishable from a frozen screen, so people
double-upload) and compression (the original is served back at full size into a
96px cell, forever).

Backend side: `src/services/image-pipeline.service.js` is the one engine every
image write goes through, and callers must hash the master **it returns**, never
the bytes they received — `document_signature` records `artifact_hash` from the
vault row's `content_hash` and `document_verification` compares the two.

## The fourth frontend rule: search finds everything

**Every page, every tab and every record is findable by ⌘K — in English and
French, and only by people who may open it. Register what you add.**

Enforced by `scripts/check-search-registry.js` (`npm run check:search` from the
repo ROOT; in `npm run ci` and CI). It fails on:

- a `<Route>` in `client/src/app/app.tsx` with no entry in
  `client/src/app/screen-registry.json` (`screens[]`, `hubs[]` or `redirects[]`);
- a hub section in `areas.ts`, or a URL-addressable tab (any `useUrlTab` value),
  with no entry — tabs go in `tabs[]` with the record types they belong to;
- a module under `src/modules` with records (a controller and a repo) and
  neither a `<module>.search.js` provider nor a `// search:none <reason>` in its
  controller — the same shape as `// ai:none`, and the reason is required;
- an entry pointing at a route, file or tab that no longer exists, or a page
  without its `title_fr`.

`npm run new:screen --prefix client` prints the registry entry with the rest of
the scaffold. A provider is a few lines with `recordProvider` from
`src/services/search/provider.js`: name the module whose `view` grant gates it,
the folded columns it matches, and the URL a result opens (its 360, or the list
with `?focus=<id>`). Words people use for a thing ("devis", "cotation") go in the
ONE synonym list, `packages/shared/schemas/search.js`, never per page.

**Why it is a gate.** A screen nobody registered is invisible three times over:
⌘K cannot find it, the shell cannot permission-filter it (route-access treats an
unregistered route as ungated) and the AI cannot cite it. None of those fail a
test. The owner's words for what search must cover were "every single one".

## The fifth frontend rule: a screen explains itself once

**Supporting text does not get printed on the page. It goes behind an ⓘ.**

Enforced by `scripts/check-prose.mjs` (`npm run check:prose` from `client/`), in
`npm run ci` and CI.

The tenant review of 8 Oct 2026 was blunt: "there is a lot of supporting text on
pages and they are useless at first glance". The measurement behind it was 805
`hint=`, 485 `description=` and 790 `.micro` paragraphs in `client/src`, 390 in
master data alone. Nobody decided a screen should carry nine paragraphs; each
was added by somebody being helpful about one field, and the whole cost landed
on a page none of them was looking at.

Work down this ladder and stop at the first rung that fits:

| Rung | When |
| --- | --- |
| **Delete it** | it restates the label, the heading or what the control plainly does |
| **Fold it into the control** | a format is a `placeholder`, a bound is `min`/`max`, a unit is an adornment |
| **Hide it behind `<Field about>` / `<InfoHint>`** | genuinely useful, more than a few words, wanted by one user in ten |
| **Leave it visible** | rare, and `@prose:keep <reason>` makes you say why |

**Hiding is not the answer for everything, and the frame matters.** Say it at
the moment it matters, not on the page. An irreversible choice becomes a
`Permanent` pill on the label or a disabled input, not a sentence nobody reads.
What a destructive action destroys goes in the `useConfirm()` body, at the point
of commit. Nobody should discover "this cannot be changed later" by hovering.

Two mechanical rules that the test suite will enforce for you the hard way:

- **The ⓘ is a SIBLING of what it explains, never a child.** Inside a `<label>`,
  an `<h2>` or a `RadixDialog.Title` its `aria-label` joins that element's
  accessible name, and "Shareholding" starts announcing as "Shareholding About
  Shareholding".
- **Hidden is not deleted.** `Field` keeps the text in a visually hidden node and
  points the CONTROL at it with `aria-describedby`. Never drop that.

`.micro` is a short caption ("Account Manager", Title Case). `.hint` is a helper
SENTENCE that earned its place. `.eyebrow` is the uppercase editorial treatment
for a single word over a figure, and so is a `subtitle` prop, which is the same
slot under a second name and capped the same way. The gate reads a paragraph
however the formatter wrapped it, and reads `text-xs/text-sm
text-muted-foreground` as prose too: the first version looked only at the rest
of the line the class was on, so 147 paragraphs were invisible and the longest
were the most likely to be missed.

**A `hint` is counted wherever it is DECLARED**, as a JSX prop, as an
`empty={{ hint }}` object property, or read from a map in the same file. All
three render identically and only the first was measured, which left 129 sites
uncounted and one hint of 139 characters on a screen the gate called clean.

**`description` and `desc` are NOT counted, because they render behind the ⓘ** —
`Dialog`, `PageHeader`, entity 360's `Section`, `Chart` and `SettingsCard` all
put theirs there. `SettingsCard` was the exception until the Configure round and
it was the expensive one: 50 printed `desc` values, 30 over the cap. If you add
a component that takes a description, render it behind an ⓘ or the gate will
under-report your screen. A CONSEQUENCE never goes in one — `SettingsCard` has
`notice` for that, printed in the card body.

Full detail, the gate's limits, and the `<PageHeader>`-versus-`<InfoHint>` split
are in **`doc/FRONTEND_GUIDE.md` §3.17**.

## The sixth frontend rule: Title Case for chrome, and no dashes anywhere

**Chrome is Title Case. Messages are sentence case. French is always sentence
case. Nothing a tenant reads contains an em dash.**

Both are enforced: Title Case by `npm run check:prose` (from `client/`), dashes
by `npm run check:dashes` (from the repo ROOT, covering all three frontends plus
the document templates and spreadsheet exports).

Chrome NAMES something: page and hub titles, nav and tab labels, section and
card titles, dialog titles that open a form ("New Service Type"), primary
buttons, column headers. Messages SPEAK to the user: toasts, empty states,
validation, helper text. "Could not save it" must not become "Could Not Save
It".

**The gate decides which is which from the COMPONENT, not the wording.**
`<Section title>`, `<SectionCard title>`, `<Panel title>`, `<Fieldset legend>`,
`<HubCrumb area>`, `<Modal title>`, `<KpiTile label>` and `<Stat label>` are
chrome whatever words they carry; `<EmptyState>`, `<Callout>` and `toast` are
messages whatever words they carry. The first version of the rule guessed from
the string (did it start with "New"?) and so never looked at a single section
card, which is exactly where the tenant found them: "Overview & format", "Usage
across the system", "Hub › Master data".

**That holds in the OBJECT form too, in both directions.** A `label:` in a tab
bar, option set, column list or KPI config is chrome; a `Record<…, string>` map
whose name says what it holds (`…_LABEL`, `…_TITLE`, `…_KIND`) carries chrome in
its values; an `eyebrow` is an area's name. But a `{ tone, title, detail }`
warning record renders as a `<Callout>`, so its title is a message, and a
`prompt({ title })` is usually a question, so neither is touched. A title ending
in `.`, `?` or `!` is a sentence and is never chrome.

**Two shapes are messages the gate used to get wrong, and both are named in
§3.18** so a fifth round cannot reopen them: a password rule ("A number") and a
validation warning ("The source image isn't square"). `@prose:keep` is
block-scoped, so one marker on the line that opens an array covers it.

**A tab's LABEL is chrome; a tab's VALUE is a URL.** `?tab=Banking %26 treasury`
is a deep link with a test pinning it, so the rename happens at the point of
display (a `TAB_LABEL` map beside `SHORT_LABEL`) and the value is left alone.

**French is never title-cased.** "Types de service", not "Types De Service".
That is correct French typography, and this product serves a corridor where half
the users read French. `title_fr`, `name_fr` and `fr.strings` are not checked
and must not be retitled.

The tenant's words on dashes were "No emdashes or double dashes anywhere. It
screams AI." He is right, and there is a second reason: an em dash in product
copy is almost always a sentence doing two jobs, which is the same
over-explaining the fifth rule exists to remove. Use a colon when the second
half explains the first, a full stop when it is a second thought, a comma when
it is an aside. A plain hyphen is fine, so a column reads `31-60`. CSS custom
properties, CLI flags, SQL comments and decrement operators are exempt
mechanically; code comments and `doc/` are out of scope by decision.

**Renaming any English label moves its dictionary key.** `tr()` and `navT()`
look a translation up BY its exact English text and fall back to English
silently, so a renamed string with a stale key renders English in the French
build with nothing failing anywhere. `node scripts/check-prose.mjs --fix-titles`
moves the key on both the `en` and `fr` sides and retitles only the English
value. It moves a key ONLY when the old spelling has left the source entirely:
the same English can be rendered from two places for different reasons
("Yard noise filter" is a section title on one screen and a checkbox label on
another), and moving the key for one of them took the French away from the
other, silently. And watch for copy used as a KEY: `AREA_ICON` is keyed by an area's
display label, so retitling the navigation silently dropped five areas onto one
glyph in an icons-only rail, with nothing failing at the type level. Full detail
in **`doc/FRONTEND_GUIDE.md` §3.18**.

## Before you write frontend code

`doc/FRONTEND_GUIDE.md` is **the** frontend document — CI fails if it names a
component that does not exist, so it can be trusted. §3.5 lists the primitives
you must not hand-roll; §6 is the pre-PR checklist.

Other gates that fail the build, all run from `client/` — `npm run ci` runs the
lot, so this list is for when you want one of them on its own:

```
npm run lint            # includes the dialog ban and the a11y rules
npm run check:palette   # no raw palette colours — they break white-labelling
npm run check:contrast  # every text-on-surface token pair clears WCAG AA
npm run check:docs      # the frontend guide is not lying
npm run check:motion    # motion budget
npm run check:prose     # supporting text is behind the ⓘ, and chrome is Title Case
                        # --fix-titles retitles and moves the dictionary keys
                        # --update-baseline after a sweep, so the ratchet holds
npm run check:shared    # the bundler can consume @praxis/shared, on one Zod
npm run check:schemas   # a shared schema is used by BOTH sides, and migrated
                        # validators have not grown their own rules back
npm run check:bundle    # chunk graph is acyclic — needs `npm run build` first
npm test
```

Three more run from the repo ROOT rather than `client/`, because they cover the
backend and the frontends at once:

```
npm run check:dates     # no month-first dates anywhere — see the rule above
npm run check:search    # every route, hub section, tab and record module is findable
npm run check:dashes    # no em dashes in copy a tenant reads, templates included
```

`platform-console/` and `public-web/` each have their own `npm run lint`. All
three share the local rules in `client/eslint-local-rules/` — that directory is
the single copy, re-exported by the other two apps, because a second copy of a
gate is a gate that drifts.

## Repository shape

```
src               # Node/Express backend (CommonJS)
client            # Tenant ERP — React 18 + Vite + TS (PWA)
platform-console  # Praxis-side admin console — React + Vite + TS
public-web        # Stranger-facing: marketing site + external portal
packages/shared   # Zod schemas shared by API and frontends — one definition each
migrations        # SQL, numbered; see the CI gates on numbering and reversibility
doc/              # PRD, OHADA knowledge base, architecture and frontend guides
```

Node 20 (`.nvmrc`), npm. Backend lint and tests run from the repo root; each
frontend app has its own toolchain and is linted, tested and built separately in
CI.

## Before you push: `npm run ci`

**Not `npm run lint && npx jest`.** That is two of the thirty-odd gates CI runs,
and passing them is not evidence about the other twenty-eight.

```
npm run ci               # every gate that needs no infrastructure, full report
npm run ci --fast        # stop at the first failure
npm run ci --backend     # or --frontend, when you only touched one side
node scripts/ci-local.js --list      # what it runs, and each gate's own command
```

It runs the gates in CI's own order and reports **all** the failures rather than
the first, so five unrelated breakages cost one run instead of five pushes. Read
`scripts/ci-local.js` — its header states exactly what it SKIPS (a live
Postgres, PgBouncer, the Docker build, the Playwright layout gate), so a green
run here is "the gates that need no infrastructure pass" and not a promise.

Two classes of gate are the ones people actually get caught by, because neither
is a test and neither fails while you are working on the thing that breaks it:

- **Generated artefacts drift.** `doc/API_REFERENCE.md` and `doc/ERROR_CODES.md`
  are generated from the code, and `generate-api-docs.js --check` fails when
  they are stale. Adding one `throw new AppError(...)` changes a count in a
  table and reddens `build-test`. The fix is never to edit the file — run
  `node scripts/generate-api-docs.js` and commit what it writes.
- **Cross-cutting gates fire from a file you did not open.** `check:schemas`
  treats any `*.validator.js` that imports `@praxis/shared` as a migrated
  adapter, so ADDING that import to a validator that still declares its own
  shape turns a green file red — the failure is in a file you only added one
  line to. Put the rule in `packages/shared`, or add an `ALLOW_LOCAL_SCHEMA`
  entry in `client/scripts/check-schemas.mjs` with the reason (partly-migrated
  validators are what the hatch is for).

And the older trap, which `npm run ci` also covers: CI's `build-test` runs
`npx jest` across the **entire** backend. A change to a **shared** function — a
service like `foldDetails`, a repo helper, a validator — breaks a suite you did
not name in a targeted `jest <file>` run, so a subset pass reads as green while
CI is not. Running one file is never a substitute for the suite.

## Conventions worth knowing

- **Validation comes from `packages/shared`**, so the API and the form agree. Do
  not re-declare a validator on one side.
- **Colour comes from tokens**, never from raw Tailwind palette classes. Accent
  *text* is `text-primary-ink`; `text-primary` is a fill.
- **Silent catches carry a taxonomy marker** — see `doc/ERROR_HANDLING.md`.
- **RBAC action is `edit`**, not `update` — the backend spells it that way.
- **Wire every module to the AI.** When you add a module, or change a module's
  reads/writes or their validators, update its `<module>.ai.js` manifest so
  Praxis AI can see and act on it — the assistant's tool catalogue is derived
  *only* from those manifests (`src/services/ai/action-registrar.js` →
  `ai_action_catalogue`). A module with no manifest is invisible to the AI, and
  a manifest that drifts from its service (wrong payload shape, a write that no
  longer passes the actor) advertises a capability the runtime cannot honour.
  See `doc/AI_ARCHITECTURE.md` §2 and the pre-PR checklist in
  `doc/BUILD_CONVENTIONS.md`. A module that genuinely has no AI surface carries
  an explicit `// ai:none` opt-out. (Full analysis + the coverage gate that will
  enforce this: `doc/PRAXIS_AI_AUDIT.md`.)
- **An AI write follows the write contract.** A manifest `write` runs as
  `service(client, payload, actor)` — an inline wrapper that maps the AI's
  snake_case payload to the service's real argument shape *and forwards the full
  actor*: `(c, p, actor) => service.create(c, { data: p, actor })` (or the
  camelCase mapping a service needs). A bare `service.create` reference is not
  allowed for a write — the flat payload lands in the wrong parameter and the
  actor is dropped (audit C1–C3). `tests/unit/ai-write-contract.test.js` enforces
  this and ratchets `src/services/ai/write-contract-baseline.json` (the backlog of
  pre-contract writes) downward only — migrate a write, then delete its key from
  that file. Reads are unaffected.
- PR titles must start with a Conventional Commits prefix; CI gates on it
  because the changelog is written from the title.
