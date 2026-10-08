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
