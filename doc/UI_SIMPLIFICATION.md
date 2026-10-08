# UI simplification: the playbook and what is left

**Status: master data swept (round 1). Smart Mail restructured and the Analytics
tab cut (round 2). The other areas are listed at the bottom, with the command
that tells you how much is left in each.**

This document exists so the sweep can be continued by somebody who was not
there for the first one. The RULES live in `CLAUDE.md` (fifth and sixth
frontend rules) and `doc/FRONTEND_GUIDE.md` §3.17 and §3.18. This is the
working method, the traps, and the backlog.

## Why

Tenant review, 8 Oct 2026. In his words: there is a lot of supporting text on
the pages and it is useless at first glance; the product should feel like
Teams, where the interface is not choked up. The acceptance criterion he gave
was that explanatory text should sit behind icons or a hover rather than on the
page, and that titles and major lines should be Title Case ("Service Types",
not "Service types"). He added one more during the work: no em dashes anywhere
a customer reads, because it reads as machine-written.

What that looked like in numbers before anything changed:

| | count |
| --- | --- |
| `hint=` in `client/src` | 805 |
| `description=` in `client/src` | 485 |
| `.micro` paragraphs in `client/src` | 790 |
| of those, in master data | 390 |
| em dashes in tenant-readable copy, repo-wide | 2600 |

## The method, in the order that worked

**1. Change the CONTAINER, not the call sites.** The single highest-leverage
edits were three components, and between them they covered several hundred
sites with no call-site churn at all:

| Component | What changed | Sites |
| --- | --- | --- |
| `ui/dialog.tsx` | `description` renders behind an ⓘ on the title, `sr-only` for AT | ~485 |
| `masterdata/entity-360.tsx` `Section` | same, for section headings | ~20 |
| `index.css` `.micro` | lost `text-transform: uppercase` | 790 |

`PageHeader` (`components/data-list.tsx`) already did this for 117 page
descriptions, from the 28 Sep 2026 review. Look for that pattern before
touching call sites: if the same prop is rendered in one place for a hundred
screens, that place is the edit.

**2. Then the call sites, densest file first.** `node scripts/dedash.py` and
`npm run check:prose` both print a ranked list. Work down it.

**3. Reseed the baselines at the end of an area, never during.**

```
node scripts/check-prose.mjs --update-baseline     # from client/
node scripts/check-dashes.js --update-baseline     # from the root
```

Both files only ever shrink, so reseeding mid-sweep locks in a worse number
than you are about to achieve.

## What the first gate missed, and why

Worth reading before trusting any number this gate prints. The tenant found all
four of these on screens the first sweep had reported as done.

**It only read the rest of the line the class was on.** A wrapped paragraph
begins on the NEXT line, so the gate saw nothing:

    <p className="mb-2 micro text-muted-foreground">
      Add each compliance document and upload its file - a PDF or a clear
      photo. No file yet? ...

147 paragraphs over the cap were invisible this way, and the longer a sentence
is the more likely the formatter wrapped it, so the gate was blindest exactly
where the problem was worst. `check-dashes.js` had the identical hole.

**It only read `.micro` and `.hint`.** 835 `text-xs/text-sm
text-muted-foreground` paragraphs, which look identical on screen, were never
scanned.

**It classified chrome by the STRING, not the component.** A title counted as
chrome if it began with New, Edit, Add. That excluded every section card,
fieldset legend and breadcrumb, which is where the tenant was pointing.

**And the doc promised more than the gate delivered.** CLAUDE.md said the rule
covered "section and card titles, nav and tab labels, column headers" while the
gate checked roughly a fifth of that, and the sweep was reported as complete on
the strength of the doc. If you widen a rule, widen the gate in the same commit
or say plainly which part is not enforced yet.

## The traps, all of which bit once

**The ⓘ must be a SIBLING of what it explains.** Nested in a `<label>`, an
`<h2>` or a `RadixDialog.Title`, its `aria-label` joins that element's
accessible name: "Shareholding" announces as "Shareholding About Shareholding",
and every `getByRole("heading", { name })` stops matching. Cost: 63 test
failures in one run.

**Focus must not open the panel.** Inside a `Dialog` the ⓘ can be the first
focusable element, so Radix's open-autofocus lands on it, the panel covers the
first field, Escape closes the panel instead of the dialog, and on close Radix
returns focus to the trigger, stealing it from the input the user just clicked.
`:focus-visible` does not separate deliberate from programmatic focus; jsdom
answers true for both. Hover and click only.

**Renaming an English label moves its dictionary key.** `tr()` and `navT()`
look a translation up BY its exact English text and fall back to English
silently. A renamed string with a stale key renders English in the French build
and nothing fails anywhere. `check-prose.mjs --fix-titles` handles this; after
any manual copy edit, check for orphans:

```
node -e "const fs=require('fs'),cp=require('child_process');
  const s=fs.readFileSync('client/src/lib/i18n-dict.ts','utf8');
  const en=s.slice(0,s.indexOf('export const fr'));
  const keys=[...en.matchAll(/^\s*\"((?:\\\\.|[^\"])*)\":/gm)].map(m=>m[1]);
  const files=cp.execSync(\"git ls-files 'client/src/**/*.tsx' 'client/src/**/*.ts' | grep -v 'lib/i18n-dict.ts'\")
    .toString().trim().split('\n');
  const blob=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
  console.log('orphaned keys:', keys.filter(k=>!blob.includes(k)).length);"
```

**THE VERSION OF THAT SNIPPET PRINTED HERE IN ROUND 1 WAS A NO-OP.** Its
haystack was `git ls-files 'client/src/**/*.ts' | xargs cat`, which INCLUDES
`lib/i18n-dict.ts` itself, so every key was trivially found in its own
definition and the check reported `0` whatever the tree looked like. Round 1's
clean run proved nothing. The `grep -v` above is the fix, and with it the tree
reports **607 orphaned keys** — a pre-existing backlog, not round 2's doing, and
the next thing worth a pass of its own.

**And the orphan check cannot catch a DUPLICATED string.** It only finds keys
nothing references at all. "That file type isn't accepted here" is written out
in five separate source files; de-dashing the inbox's copy left the other four
referencing the old key, so no orphan was reported and the message simply read
differently on two screens. After a sweep, also check every string you changed
for surviving copies:

```
git grep -F "<the old string>" -- client/src platform-console public-web
```

**Copy is sometimes a KEY.** `AREA_ICON` and `EXTRA_AREA_ICON` are keyed by an
area's display label, so retitling the navigation missed every key and dropped
five areas onto one glyph in an icons-only rail. Nothing failed at the type
level: the maps are `Record<string, …>`. `nav-model.ts` also held a SECOND copy
of the nav labels that the gate did not scan, so the drawer and the ribbon
disagreed in the same build. Grep for a label before changing it.

**A bulk de-dash eats leading separators.** A string that STARTS with the
separator (`" — none yet"`, `" — live"`) has no left half, so a naive
replacement drops the separator and the UI renders `0 optionsnone yet` and
`v1live`. `scripts/dedash.py` now leaves that shape alone, but read the diff
after every run regardless. Four strings were damaged this way in the first
pass and were found by reading, not by a test.

**The gate counted captions as prose.** `.micro` is also the class on "Account
Manager". Counting any `.micro` with a space in it made a screen score worse
the more it was cleaned up. The gate now requires sentence length.

## Round 2, and the thing it changed about the method

**Not every area is a copy problem, and Smart Mail was not one.** The brief for
round 2 was Smart Mail and the Analytics tab, with the same expectation round 1
set: find the printed paragraphs, delete or hide them. The measurement said
otherwise before any code was written, and it is worth knowing how to take that
measurement, because it saves a wasted round:

| | Smart Mail | Analytics tab |
| --- | --- | --- |
| `prose-baseline.json` budget sites | **6** in all of `inbox/**` | 1 |
| gate-counted em dashes | 104 in all of `features/comms` | 15 |
| what was actually wrong | layout and density | the copy, and no `tr()` at all |

**Read the gate, not a grep.** The brief for this round quoted 886 em dashes in
Smart Comms and 342 in My Workspace. Those are raw greps; the gate-counted
figures were 104 and 51. The difference is ~90% JSDoc headers, which §3.18 puts
out of scope by decision, and these files carry unusually long ones. A grep over
`—` will tell you an area needs a week when it needs an afternoon. The numbers
that mean anything are:

```
cd client && node scripts/check-prose.mjs --update-baseline && git diff --stat
node -e "const b=require('./scripts/dash-baseline.json');
  let n=0; for (const [k,v] of Object.entries(b)) if (k.includes('features/comms')) n+=v;
  console.log(n)"
```

**So Smart Mail was restructured instead.** Judged against Outlook, which is
what the tenant was comparing it to, the defects were all geometry:

| | before | after |
| --- | --- | --- |
| conversation row | 101px, four stacked lines, fixed padding | 49 / 53 / 61px, two lines, `py-row` |
| rows visible in a 574px pane | 5 | 10 |
| strips of chrome above the list | 4 | 1 |
| what scrolls | the page, carrying the list and the reading pane with it | each pane, itself |
| Reply, Archive | a footer below every message; Archive unreachable without closing the thread | a command strip at the top of the pane |
| keyboard | none, and 3 tab stops per row | one tab stop, then arrows / j / k / Enter / x / s |

**The density preference was already there and the mail list was the only list
ignoring it.** `lib/density.ts` has had compact / default / comfortable with a
saved preference and a browser gate since Phase 5. Before reaching for a new
toggle, check whether `py-row` is the answer.

## The traps round 2 added

**A jsdom test cannot see a layout defect, so pin the NUMBER in a browser.**
The mailbox was written as three panes and shipped as a scrolling document for
two years with every test green. `ThreadList`'s `overflow-y-auto` was present
and correct in the source; what was missing was a definite height anywhere above
it, and `flex-1` against an unconstrained parent is `flex-basis: 0` and grows to
its content. jsdom has no layout engine, so nothing could tell the two apart.
`e2e/mail-workstation.spec.ts` is the gate; `e2e/layout.spec.ts` is the model for
the style.

**Prove the gate, and be ready to delete your own work.** The first version of
the height chain also clipped `<main>` for `/comms/mail`, on the model of the
chat workstation. Probing the new gate against its own regression showed that
class did nothing — `<main>` measured 761px of content in a 761px box either way
— and that keeping it would have left `<PullToRefresh>` permanently armed on a
touch desktop, because the pull arms when its scroll container is at the top and
a container that cannot scroll is always at the top. 28 lines of shell change
went in the bin on the first probe.

**A module-level `tr()` freezes the English.** It runs once at import, before
`bindLanguageOwner` has chosen a language, and never updates on a switch. Every
constant stays an English dictionary KEY and is resolved at the point of use —
which is what `folder-rail.tsx`'s `folderLabel()` has always done.

**`tr()` cannot hold one English word with two meanings.** `strings."Open"` is
"Ouvrir", the verb, because that is what every button rendering it means, and the
same key is rendered as the label of a COUNT on three stat tiles, where the
French build says "Ouvrir" over a number. `split-pane.tsx` documents hitting
this and worked around it by not rendering the word. `trc("Open", "state")`
(lib/i18n.ts) looks for `strings."Open_state"` and falls back to `tr()`. Use it
only where one word genuinely carries two meanings. **The three pre-existing
tiles are still wrong:** `hr/discipline.tsx`, `support-page.tsx` and
`master/service-type-dossier.tsx`.

**Translate the KEY and the FILTER together, or neither.** The Blocked panel
grouped its chips on `row.assigned_to_name || "Unassigned"` and filtered its
rows against the same literal. Translating one and not the other matches
nothing — and in English the two are identical, so the chip would have returned
an empty list only in French. One binding, in the memo's deps.

**A comma after a JSX expression on the next line renders as " , ".** JSX joins
the line break with a space. The comma has to go inside the expression.

## Round 3 — the Monitor family, and the holes that let two sweeps lie

**The gate was the problem, not the backlog.** Rounds 1 and 2 both reported an
area done on the strength of `check:prose`, and both times the tenant found
sentence-case chrome by opening the screen. This round started by widening the
gate and letting it state the real backlog, which is the only reason the numbers
below are bigger than the brief's.

### Hole 1 — chrome defined in an object literal

Both gates read JSX attributes and CSS classes. A tab bar, an option set, a KPI
config, a column list and a wizard-step list are neither:

    const TABS = [{ key: "mine", label: "My mailbox", ... }];

**991 sites in `client/src`.** That is why the Smart Comms setup page still had
ten sentence-case tabs after round 2 swept the area it sits in.

`label:`, `title:` and `tabLabel:` object properties are now read. `text:`,
`name:` and `description:` are deliberately not: `badge.text` is a count ("3
locked invoices"), `name` is usually a record's own data, and `description`
lives behind the ⓘ by convention and costs the reader nothing.

It **ratchets** through `prose-baseline.json`, like `budget` and `longCopy`.
Holding 991 sites to a new rule in one commit is how a gate gets reverted.
`--fix-titles` touches this bucket only behind `--only <path>`, because the same
property name carries names AND messages: "SMTP login rejected" and the password
rule "A number" are both `title:`/`label:` strings and both correctly sentence
case.

### Hole 2 — a computed `title=` was dropped silently

The string extractor expected the attribute to open with a literal or a `tr(`.
Anything else returned `null` and the site vanished with no warning:

    title={tr("New message")}                               checked
    title={title || (draft ? tr("Continue this draft")
                           : tr("New message"))}             NOT checked

which is why the mail composer's dialog read "New message" through two sweeps.
Every branch of the expression is now checked, each against the chrome-prefix
rule separately, so "New message" is flagged and "Continue this draft" is not.
**That surfaced 71 sentence-case dialog titles across 41 files**, none of which
any gate had ever read.

### Hole 3 — the page title. The biggest one, and the oldest.

`<PageHeader title>` IS the page's `<h1>`, §3.18 has named page titles as chrome
since it was written, and the tenant's own words were "titles and major lines
should be Title Case (Service Types, not Service types)". It was never checked:
`CHROME_COMPONENT` lists the five components added when the rule was widened and
`PageHeader` is not one of them.

Adding it found 17. Then the matcher itself turned out to be broken two ways:

- **`[^>]*?` cannot cross a ">"**, and a page header's `eyebrow` prop is JSX
  holding one. The scan stopped inside the eyebrow, matched the nested
  `<HubCrumb area="Procurement">` (already Title Case), and called the tag
  clean. **Every page header carrying a breadcrumb was exempt by accident** —
  most of the hub pages in the app, including `masterdata/service-types.tsx`,
  whose "Service types" is the tenant's OWN example of the rule, unfixed through
  three rounds.
- **walking forward line by line instead ran PAST the tag's end**, so `<Section
  title={tr("Queries")}>` picked up the `<EmptyState title="No queries">` nested
  inside it and reported a message as chrome.

The opening tag is now read as a span with `{}` depth and quotes tracked, and
only the component's own top-level attribute is taken. `ListPage` joins
`PageHeader` — it renders an `<h1>` too. **61 more page titles**, 60 retitled.

**And the registry had been right all along.** `screen-registry.json` has said
`"Service Types"` since round 1, because the gate DID check the registry. The
page rendering it said "Service types". So ⌘K, the breadcrumb and the page
heading disagreed in the same build, on 74 screens, for three rounds — and
every one of the 74 now agrees with the registry rather than the registry being
changed. If a page title and its registry entry ever diverge again, the page is
the thing that drifted.

### And a fourth: the dotted-key `t()` catalogue

`SKIP_TITLE` excludes a dotted translation key on purpose, because capitalising
`hr.myPayslips` would break the lookup. It also excludes the VALUE, and in the
`dash:` block those values are the Control Tower's KPI tile labels — the first
thing anyone sees on that screen. **46 were sentence case.** Swept by hand:
units like "vehicles" rendered after a number, the search placeholder, the
band's own status counts and every value holding a `{{token}}` are left alone,
and the French half is untouched. `nav:` and the other blocks were NOT swept.

### `--fix-titles` was silently untranslating

It holds a dictionary key back when the old spelling survives in the source, and
its comment promised the new key was added beside it. **It was not** — the
branch just skipped, so the retitled label got no key at all and `tr()` answered
with the English. "New message" is a key with a real French value that survives
in a CODE COMMENT and a scaffold spec, neither of which renders anything. **7 of
this round's first 66 retitles landed that way.** The new key is now added
beside the old, carrying the same translation.

### What the gate still does NOT read

Said out loud rather than implied, which is the mistake rounds 1 and 2 made:

- **`<Dialog title>` by component.** A dialog names a form ("New Service Type")
  or speaks ("Remove the account manager?"), and only the prefix rule separates
  those, so a dialog titled "Mail setup guide" passes.
- **`Record<Enum, string>` label maps** (`STATUS_LABEL`, `PRIORITY_LABEL`). A
  regex cannot tell one from a route or icon map. And "In progress" also comes
  out of the global `enumLabel()` formatter, so Title Casing the map alone would
  disagree with every other enum pill in the product. Changing `enumLabel()` is
  an app-wide decision, not a Monitor one.
- **the rest of the dotted-key catalogue** (`nav:`, `common:`, `shell:`, `hr:`,
  `portal:`, `mail:`, `settings:`).
- **bare JSX text** as a title, where the words start on the line after the tag.

### Monitor, by the numbers

| | before | after |
| --- | --- | --- |
| object-literal chrome sites | 224 | **0** |
| over-length visible prose | 23 | **0** |
| files over the prose budget | 5 | **2** (mail-setup-wizard 9→7, task-panel 5→4) |
| gate-counted em/en dashes | 142 | **37** (all empty-value glyphs and JSDoc) |
| sentence-case page titles | 11 | **0** |
| sentence-case KPI tile labels | 46 | **0** |

Repo-wide, because the holes were holes everywhere: 71 computed and JSX dialog
titles and 61 page titles retitled outside Monitor, **359 distinct case-only
retitles in all**, and the dash backlog 1496 → 1337.

`prose-baseline.json` after reseeding: `objTitle` 653 (Monitor 0), `longCopy`
136 (Monitor 0), `budget` 764 (Monitor 65, of which only the two files above are
over the default of 3).

### Classification: the 224 were not all chrome

The scanner over-reports by design and the reliable signal is **what consumes
the array**, not the wording. Three shapes are messages, and two are now
excluded STRUCTURALLY rather than by hand-written exemptions:

- **`empty={{ ... }}`** — the JSX form of an `<EmptyState>`'s props. Only
  `empty: {` was matched, so eight "No calls yet" / "Nothing has bounced" empty
  states were reported as sentence-case chrome.
- **a title ending in `?` or `!`** — `confirm({ title: "Delete this
  conversation?" })` is unmistakably a message whatever property it arrives
  under, and ten of Monitor's sites are these.
- **a complete statement**, which cannot be detected mechanically and carries
  `@prose:keep <reason>`. Six in Monitor: the four clause-shaped support-ticket
  kinds ("Support: I need help" is a sentence the user is saying about
  themselves, not a name) and two thread-attention strings.

§3.18 now states that a select option, a radio label and a status pill ARE
chrome, and where the line falls between a name and a statement. Round 2 decided
the opposite and wrote it only in a commit message, which is why this round
nearly reversed it.

### The traps this round added

**`@prose:keep` must be on the line ABOVE the component, or the line itself.**
`exempt()` reads those two lines and nothing further up, so a four-line
explanatory comment ending above the tag does NOT exempt it. That cost two
strings, retitled anyway on the next run: "My workspace has moved" and "Régie
d'avance", the second a French term with no Title Case form at all. Put the
prose in one comment and the marker in a second, one-line comment directly
above the component.

**A sweep of one area creates divergences with the areas it borders**, and the
baseline hides them. These were found by reading, not by a gate:
`VERIFICATION_COPY` (components/operations/place-meta.ts) and `STATE_NOTE`
(dashboard/components/itinerary-panel.tsx) are parallel maps over the same state
drawn as the same pill; "No transport" is written out in three files; the reading
pane's Mark Read and the thread list's bulk Mark Read are the same action; and
`operational-activity-panel`'s pill text has to match the filter option that
selects it. After sweeping an area, grep every string you changed:

    git grep -F "<the old string>" -- client/src platform-console public-web

**A bulk rename of test expectations is about 30% wrong.** Applying this round's
rename map to every test file touched 26 files; **12 had to be reverted** after
checking the source: `enumLabel()` output, a field label that only shares its
wording with a page title, synthetic fixture data, and code comments. The map is
a starting point; the suite is the authority. Run it and fix what fails.

**And run the WHOLE Playwright suite, not the three specs a brief names.**
`npm run ci` skips Playwright entirely, so CI is the only signal — and the three
specs named in this round's brief (`layout`, `mail-workstation`,
`analytics-mobile`) all passed locally while `call.spec.ts` was red on the
runner. The failure was a spec given the CASE rename and not the DE-DASH:
two rename maps applied to one file in two passes, where the second map's key
was the string the first had already rewritten. Cross-checking every
`name: "..."` in all 11 specs against the source is the cheap version of this
check; the 35 that match nothing are fixture data, not pins.

    cd client && npm run build
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test

**A separator can be JSX, not a string.** Three em dashes hid in template
literals (`` `Due — ${dueTitle(d)}` ``) and one sat between two expressions as
bare JSX text (`{tr("Call summary")} — {tr("…")}`). `check-dashes.js` counts all
four, so they were in the backlog the whole time; `dedash.py` reads single- and
double-quoted strings only, so its FIXER could not see one of them. The gate was
right and the tool was blind, which is the reverse of the usual failure here.

**A duplicate dictionary key does not error — the LAST one wins.** Verify after
any dictionary change, and on a MERGE keep the LAST. The snippet is under "The
traps, all of which bit once" above. This round ended on **3503 keys each side,
0 duplicated**.

### `dedash.py` was wrong three ways, and is fixed

The next round will run it, so this matters more than the strings it changed:

- an **interpolated range** (`"{{from}}–{{to}} on your side"`, a time span)
  became `"{{from}}: {{to}} on your side"`, which reads as a label and a value.
  The numeric-range rule now covers `{{token}}` and `${expr}`.
- a **colon in front of a coordinating conjunction**: "...nothing malicious: but
  from that row". Those take a comma.
- a **parenthetical pair** had only its LAST dash rewritten, leaving one em dash
  standing AND the sentence cut in half ("a summary: it opens here"). Running
  the tool twice does not help; it yields two colons. Parentheticals are now
  listed for a human instead of half-rewritten. There were 3 in Monitor.

**And it does not move dictionary keys.** 30 of the strings it rewrote had
orphaned theirs and silently lost their French. Moving them is a separate step,
and the French half wants the same punctuation the English chose, because the
gate scans `fr.strings` too. Two French values also came out carrying an English
"to" from the range fix and had to be corrected to "à".

### Control Tower: measured, and NOT restructured

Round 2's lesson was that an area can be a geometry problem rather than a copy
problem, so this was measured before deciding. Reporting rather than acting was
a deliberate call: this PR already carries two gate rewrites.

Its over-length prose count was 5 and is now 0, so **copy was never its
problem**. What the measurement does say:

| | |
| --- | --- |
| stacked blocks on a live tenant | **10** (hero, passkey nudge, filters, a strip holding one button, map+list grid, activity panel, KPI band, briefing, app launcher, recent activity) |
| position of the KPI band | **7th of 10** |
| chrome strips between the hero and the map | **2** (`TowerFilters`, then a right-aligned row whose only child is "Meeting view") |
| what scrolls | the page, as a document |

The scroll is a DECISION, not the Smart Mail defect: `index.tsx` carries a
docblock on why a `h-[calc(100vh-7rem)]` height chain was removed. Leave it.

The finding worth acting on is the band's position. A manager opens the Control
Tower for the numbers, and the numbers sit below a map, a shipment list and an
activity panel. That is the Analytics lesson exactly — numbers you read at a
glance, not a page to scroll — and moving `<KpiStrip>` above the map grid is a
small change that wants a browser measurement and an e2e spec of its own, on the
model of `e2e/mail-workstation.spec.ts`. `e2e/layout.spec.ts` is the only spec
that touches this screen today.

### i18n: measured at 923, and deliberately deferred to PR 2

The brief estimated ~370 untranslated strings in Monitor. Measured:

| area | untranslated props | bare JSX prose lines | `tr()` calls | lines |
| --- | --- | --- | --- | --- |
| Control Tower | 335 | 56 | 31 | 8,992 |
| My Workspace | 164 | 55 | 164 (146 of them in Analytics) | 10,379 |
| Praxis AI | 33 | 23 | **0** | 1,922 |
| Smart Comms | 183 | 46 | 1,508 | 28,576 |
| Support & Feedback | 26 | 2 | 18 | 1,010 |
| **total** | **741** | **182** | | |

**About 923 strings, not 370**, and many sit in module-level constants where
`tr()` cannot wrap the definition — a module-level `tr()` freezes the English at
import — so the call has to move to the render site one site at a time. That is
a PR of its own. The copy had to settle first in any case: the dictionary key IS
the final English, and wiring before the copy settles means moving every key
twice.

Praxis AI is the place to start: 1,922 lines, zero `tr()` calls.

## What is done

- `ui/info-hint.tsx` (new), `<Field about>`, `.hint` and `.eyebrow` classes
- `check:prose` + `prose-baseline.json`, `check:dashes` + `dash-baseline.json`,
  both wired into `scripts/ci-local.js` and `.github/workflows/ci.yaml`
- 175 chrome labels retitled, dictionary keys moved on both sides
- master data: the service type form (14 rows to 7, Incoterms behind a summary
  button), the container-detail cards, the account-manager block, entity 360's
  sections, and 139 de-dashed strings

Round 2:

- **Smart Mail**, restructured rather than swept: the height chain, one command
  strip in place of four, a density-linked two-line row, Reply and Archive at
  the top of the reading pane, and keyboard navigation. `Checkbox` gained an
  opt-in `tabIndex`; `SplitPane`'s panes gained `min-h-0`; the mailbox gained an
  `sr-only` `<h1>` it had never had. `e2e/mail-workstation.spec.ts` (8 tests)
  holds the numbers.
- **the Analytics tab**: eight paragraph subtitles folded into the ⓘ that was
  already beside them, four headline figures with their captions behind one ⓘ,
  one Charts/Tables control in place of eight, the Blocked panel's three pieces
  of copy about its own chip row deleted. `trc()` added to lib/i18n.ts.
- **Analytics wired to `tr()`**: 146 new en/fr pairs, 32 reused. It had ZERO in
  1,500 lines.
- **the Tasks module**: the ladder on its four prose sites, 19 de-dashed strings,
  Title Case on the dialogs, their buttons and the field labels.
- 54 further de-dashed strings across `comms/inbox/**` and the client dictionary,
  with all 21 affected keys moved on both sides and the French separator matched
  to the English choice.
- `scripts/dedash.py`'s `FILES` now points at round 2's area, so the diff of
  that one line is the record of which rounds have been done.

## What is left

Run these for the current numbers; they are the backlog, ranked:

```
cd client && mv scripts/prose-baseline.json /tmp/pb.json \
  && node scripts/check-prose.mjs ; mv /tmp/pb.json scripts/prose-baseline.json
node -e "const b=require('./scripts/dash-baseline.json');
  console.log(Object.entries(b).sort((a,c)=>c[1]-a[1]).slice(0,25))"
```

Areas in rough order of how much a tenant looks at them:

1. **operations** (the file/dossier screens: the daily surface)
2. **finance** and **costing** (invoice, costing and quotation forms)
3. **sales** (quote requests)
4. **hr**, **fleet**, **wms**
5. **settings** and **governance** (seen rarely, explain more, lower priority)

### Measured and deliberately not done in round 2

These are counted, not guessed, so the next round can be scoped before it
starts rather than after:

| | what is left | why it was left |
| --- | --- | --- |
| **My Workspace i18n** | `tasks/**` has 7 `tr()` calls in 3,600 lines; `calendar/**`, `today.tsx` and `labels.ts` have almost none | ~200 strings. Wiring it rides on nothing in this change and would have doubled an already large diff. Analytics went first because its copy was being edited anyway, so its keys are final. |
| **orphaned dictionary keys** | **607**, with the corrected check above | pre-existing, and its own job: each one is a string that was edited without its key |
| **the client dictionary's own dashes** | 324 allowed in `lib/i18n-dict.ts`, of which 21 were cleared here | the French half of every string is tenant-readable copy and the gate does scan it. A bulk pass is mechanical but wants its own review, not a corner of a layout PR. |
| **the rest of Monitor** | Control Tower (31 files), Praxis AI (3), Support & Feedback (6) | the stretch target was spent on Tasks instead: same hub as Analytics, shared modules, 47 `.micro` to Analytics's 11, and every Analytics drill-down lands there |
| **`tr("Open")` on three stat tiles** | `hr/discipline.tsx`, `support-page.tsx`, `master/service-type-dossier.tsx` | they render "Ouvrir" over a count. `trc(…, "state")` is the fix and it is one line each; they are outside this round's two areas. |
| **Smart Comms outside the inbox** | `setup/**`, `signatures/**`, `mail-setup-wizard.tsx`, `team-chat.tsx`, `call/**` | Smart Mail proper was the commitment. These carry 21 budget sites and 64 dashes between them. |

`platform-console/` and `public-web/` have their own copies of nothing here yet:
`check:prose` takes `--app`, so point it at them when their turn comes.

## One open decision

`<PageHeader>` expands its description INLINE on click; `<InfoHint>` opens a
popover on hover. Two different ⓘ behaviours in one product. The split is
defensible (a page-level description is worth a paragraph and has room for one)
but it was inherited rather than chosen. If the tenant wants one behaviour
everywhere, `PageHeader` is the one to change, and its tests pin the toggle.
