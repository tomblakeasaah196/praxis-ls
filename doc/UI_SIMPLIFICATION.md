# UI simplification: the playbook and what is left

**Status: master data swept. The other areas are listed at the bottom, with the
command that tells you how much is left in each.**

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
  const blob=cp.execSync(\"git ls-files 'client/src/**/*.tsx' 'client/src/**/*.ts' | xargs cat\",{maxBuffer:1e9}).toString();
  console.log('orphaned keys:', keys.filter(k=>!blob.includes(k)).length);"
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

## What is done

- `ui/info-hint.tsx` (new), `<Field about>`, `.hint` and `.eyebrow` classes
- `check:prose` + `prose-baseline.json`, `check:dashes` + `dash-baseline.json`,
  both wired into `scripts/ci-local.js` and `.github/workflows/ci.yaml`
- 175 chrome labels retitled, dictionary keys moved on both sides
- master data: the service type form (14 rows to 7, Incoterms behind a summary
  button), the container-detail cards, the account-manager block, entity 360's
  sections, and 139 de-dashed strings

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
3. **sales** and **comms** (quote requests, the inbox)
4. **hr**, **fleet**, **wms**
5. **settings** and **governance** (seen rarely, explain more, lower priority)

`platform-console/` and `public-web/` have their own copies of nothing here yet:
`check:prose` takes `--app`, so point it at them when their turn comes.

## One open decision

`<PageHeader>` expands its description INLINE on click; `<InfoHint>` opens a
popover on hover. Two different ⓘ behaviours in one product. The split is
defensible (a page-level description is worth a paragraph and has room for one)
but it was inherited rather than chosen. If the tenant wants one behaviour
everywhere, `PageHeader` is the one to change, and its tests pin the toggle.
