# PR 3 of 4 — Money, master data and signing

> Tenant review of 29 Sep 2026 ("meeting 6"). Owner decisions answered 2026-10-01.
> Evidence and decisions: [register.md](register.md) (items 3.1–3.9, decisions F1–F6).

You are working in the praxis-ls repository: Praxis LS, a white-label, multi-tenant logistics
and OHADA-accounting ERP. Backend Node/Express in `src/`, staff app in `client/`, public website
and client portal in `public-web/`, shared Zod schemas and rules in `packages/shared`. Read
`CLAUDE.md` before writing any code and follow it exactly.

This PR carries the highest cost of a mistake of the four: it touches exchange rates, accounting
classification and signatures. Prove each change with tests, and when the register and the code
disagree, trust the code, say so in the PR, and carry on.

## Context

- **The euro rate is wrong.** The tenant's Currencies screen showed 1 EUR = 656.168 XAF. The
  BEAC fixed parity is **655.957** (the BCEAO one for XOF is the same). 656.168 is 1 / 0.001524,
  the exchange-rate feed's rounded figure, stored as-is by the nightly and "on add" sync
  (`src/modules/master/currency/currency.sync.js:55-120`). Costings pre-fill their rate from it.
  Worse, a rate a treasurer sets by hand is beaten by the next night's feed: the resolver prefers
  an override only on the SAME date (`src/modules/master/currency/currency.rules.js:9-18`).
- **Débours vs own cost.** The dictionary deliberately carries siblings per fulfilment mode
  ("Gate-Pass Fee — Client Account" = débours, "— Own Cost" = our expense; seed `9082`), but no
  picker explains or links them, and a wrong pick posts to the wrong account.
- **A new dictionary line needs GL accounts** that an operations user cannot be expected to know
  (`client/src/features/masterdata/financial-dictionary-form.tsx:655`,
  `src/modules/master/financial_dictionary/financial_dictionary.service.js:211`).
- **A rate's VAT basis is free text** (`src/modules/master/expense_rate/expense_rate.validator.js:14,23`).
- **Operating locations take any two letters** — Gabon was saved as GB, the United Kingdom.
- **A draft client cannot be deleted**, so the CINECAM test client stays in LIVE.
- **Signing on a computer without fingerprint or face** means an emailed code for every single
  signature.
- **An empty LIVE looks broken** to the tenant.

## Read first

- [register.md](register.md): sections 0–2, the whole "PR3" section, "Owner decisions › PR3".
- `doc/OHADA_KB.md`, `doc/CURRENCY_MODULE_AUDIT_2026-09-19.md`, `doc/SIGNATURE_ENGINEERING_GUIDE.md`,
  `doc/AI_ARCHITECTURE.md` (and §2), `doc/BUILD_CONVENTIONS.md`, `doc/ERROR_HANDLING.md`.
- The header of `migrations/seeds/9082_seed_dictionary_reclass.sql` — why siblings exist.
- The header of `src/modules/vault/document_signature/signing-proof.service.js` — what a
  signature proves today.
- `doc/FRONTEND_GUIDE.md` §3.5, §3.10, §3.12, §6.

## Owner decisions (final — do not re-ask)

- **F1 EUR parity.** Locked. EUR ↔ XAF and EUR ↔ XOF always resolve to 655.957, shown as a fixed
  parity; the feed never touches them and nobody can type another figure. Open DRAFT documents
  priced at another EUR rate are re-priced; signed, sealed or posted documents stay exactly as
  they are. The "override beaten by the next night's feed" bug is fixed for every currency.
- **F2 Débours vs own cost.** Pickers show a line like Gate-Pass Fee ONCE. Picking it asks one
  plain question — "Billed to the client at cost" or "Our own cost" — preset from the file, and
  the right sibling is used behind the scenes. A mismatch is flagged before saving.
- **F3 Accounting of a new line.** The AI suggests the OHADA posting for that line — Gemini
  searching the web for how OHADA records it — and pre-fills it. Anyone with dictionary create /
  edit rights (operations or finance alike) can edit and save it. No accountant-only gate.
- **F4 VAT basis.** Each rate says whether its figure includes VAT. If it does, the HT
  equivalent is stored and both are shown, so a costing never adds VAT twice. Débours lines are
  always HT.
- **F5 Vendor access.** No change: the JBS Praxis login is an SMART LS employee's account.
  Nothing about support access, the CEO role or headcount is in scope.
- **F6 Signing without fingerprint / face on the computer.** Offer the phone's passkey first
  (scan a QR, confirm on the phone); the emailed code is only the last resort. Plus a **5-minute
  window**: one confirmation also covers the same person's further signatures for 5 minutes.

**Auditor defaults** (applied unless the owner overrides them; recorded in the register):

- Discarding a client is allowed only for a DRAFT with no history; anything else keeps
  "Deactivate".
- Operating-location countries come from the shared ISO list.
- An empty LIVE shows a short go-live checklist.

## What to build

### A. The fixed EUR parity (3.1, F1)

- **Where the fact lives.** The parity is a legal fact about the currency, so it belongs in the
  shared currency reference: `packages/shared/data/currencies.js` gives XAF and XOF a peg (to EUR,
  655.957, with its source: BEAC / BCEAO). Never as a literal in `src/modules/costing` or
  `src/modules/commercial` — the "no hardcoded FX literals" gate
  (`scripts/check-currency-literals.js`) scans those.
- **Resolution.** Every reader — `rateFor`, the rate map, `convertAmount`, the costing pre-fill
  (`GET /costings/fx-rate`) — returns the parity for a pegged pair in either direction, computed
  from the peg itself (never the inverse of a rounded stored figure), marked as fixed. Other
  currencies keep their feed and override behaviour.
- **Writes.** The sync skips pegged pairs and reports them as "fixed parity"; the Set-rate form
  and API refuse a pegged pair with a clear message; the costing's rate field is read-only for a
  pegged pair. Currencies & FX shows a "Fixed parity (BEAC)" badge.
- **The override bug, for every currency.** A manual override stands until a newer override or
  until someone releases it ("Follow the feed again"); a later feed row no longer beats it. Change
  `pickRate` (`currency.rules.js:9-18`) and the "latest rates" query
  (`currency.repo.js` `latestRatesFromBase`) together, with tests.
- **Repair.** Find every DRAFT document that stores a EUR rate or EUR-converted figures —
  costings (one rate per costing since #497), margin simulations, quotations, proformas and any
  other you find — re-price it at the parity, leave a note on it ("Re-priced at the fixed parity
  655.957; was 656.168"), and audit it. Signed, sealed, sent or posted documents are never
  touched. Report the count per document type in the PR.
- Update `currency.ai.js` and the currency audit doc's status line.

### B. Débours vs own cost — one line and a toggle (3.2, F2)

- **Link the siblings.** Add an explicit sibling link on `dictionary_item` (a group key), in your
  migration range. Backfill it from seed `9082`'s naming (base label + "— Client Account" /
  "— Pour Compte Client", "— Own Cost" / "— Charge Propre", "— Deposit" / "— Dépôt") and its
  `parent_code` where present. List any line the backfill could not pair in the Financial
  Dictionary settings for a person to confirm.
- **Every picker shows a group once:** the costing line picker
  (`client/src/features/costing/costing-lines.tsx`), the dictionary finder
  (`client/src/components/dictionary-finder.tsx`), `catalogue-select.tsx`, the invoice / quotation
  line picker (`client/src/features/finance/line-picker.tsx`), margin simulations and Suggest
  charges.
- **On pick**, one plain question with the right sibling behind each answer:
  - "Billed to the client at cost — débours, no VAT" / "Refacturé au client au prix coûtant —
    débours, sans TVA";
  - "Our own cost" / "Notre propre coût";
  - "A deposit we lodge" when a Deposit sibling exists.
  Preset it from the context: a line the costing bills to the client presets "billed"; an
  internal, own-fleet cost presets "own cost".
- **The guard.** An own-cost sibling on a client-billed line, or a débours sibling on an internal
  cost, is flagged before saving, with one sentence saying why and a one-tap switch.
- Codes, posting rules and stored history of existing lines do not change.

### C. The AI suggests a new line's OHADA posting (3.3, F3)

- In the dictionary create wizard (`client/src/features/masterdata/financial-dictionary-form.tsx`),
  a "Suggest the accounting" action — offered automatically once the label and category are
  filled — proposes the direction, the débours flag, the VAT treatment and the posting rules
  (context × debit / credit accounts) under SYSCOHADA, and pre-fills the "OHADA posting" block.
  Anyone with dictionary create / edit rights edits and saves. Posting rules stay mandatory at
  save (`financial_dictionary.service.js:211`).
- **Sources, in this order:**
  1. the tenant's own dictionary — lines with similar names or categories and their posting
     rules (the company audited all 177 seeded rows, seed `9082`);
  2. the tenant's chart of accounts — a suggestion resolves to EXISTING leaves, or offers the
     existing "mint a missing CoA leaf" panel; it never invents an account silently;
  3. `doc/OHADA_KB.md` and the AI knowledge layer;
  4. the web, through Gemini with Google Search grounding. `src/services/ai/llm.service.js` uses
     Gemini's OpenAI-compatible endpoint, which does not carry Google Search; call the native
     `generateContent` the way `src/services/ai/gemini-transcription.service.js:147` already does,
     and check Google's current documentation for the grounding request shape before coding.
- **Show why.** A short rationale and the sources (web titles and links) beside the suggestion.
  Record in the audit trail that the posting was AI-suggested, and who accepted or changed it.
- Respect the tenant's AI switch: with AI off, no key, or a failed call, the form works exactly as
  today. One call per click; cache by normalised label.

### D. A rate says whether it includes VAT (3.4, F4)

- The standard-rate entry (expense rates, and the dictionary's "Edit standard rate") gains
  "Price includes VAT", off by default. When on, store the HT figure = TTC ÷ (1 + the line's VAT
  rate) and show both ("72 700 TTC = 60 964 HT at 19,25 %"). The toggle is not offered on débours
  lines.
- Existing rates are not changed. List those whose note mentions TTC / "VAT inclusive" /
  "TVA incluse" for a person to review.
- The shape lives in `packages/shared`; update `expense_rate.ai.js`.

### E. Operating-location countries (3.5)

- Replace the free two-letter box in "Where it operates"
  (`client/src/features/masterdata/entity-public-story-tab.tsx:288-300`) with
  `client/src/components/country-select.tsx`.
- The schema (`packages/shared/schemas/site-settings.js:249`) accepts only real ISO alpha-2
  codes, from the shared countries list.
- A row is never silently dropped on save (`:361-366`): an incomplete row blocks the save with a
  message.
- Existing rows whose code is not a real country, or whose label names a city of another country
  (Libreville under GB), are flagged on the entity, not auto-fixed.

### F. Discard a draft client (3.6)

- A DRAFT client with no history — no operations file, invoice, receipt, journal line, quote
  request, proposal, quotation or portal activity — can be deleted: one transaction removes it
  and its own children (contacts, addresses, registrations, documents, portal grants and invites),
  audited with a full snapshot.
- Anything with history is refused with "Deactivate instead".
- RBAC: the client master's `delete` action. A destructive `useConfirm` naming the outcome. The
  AI may not delete.

### G. Signing on a computer without fingerprint or face (3.7, F6)

- **G1 Phone first.** In `client/src/components/signing/use-signing-proof.tsx:106-117`, a device
  without a platform authenticator goes straight to the emailed code. Instead:
  - when the person has a passkey, run the ceremony anyway so the browser offers "Use a phone or
    tablet" (QR, then fingerprint on the phone). The server already sends each credential's
    transports (`signing-proof.service.js:64-90`);
  - a person with no passkey is offered to set one up from their phone first;
  - the emailed code only when that is cancelled or impossible.
- **G2 The 5-minute window.** After a successful passkey or code proof, open a signing window
  for that person on that session:
  - 5 minutes from the proof, never extended by use;
  - ends on sign-out, the lock screen, or "End now";
  - the same person's next signatures on the same session need no new proof;
  - each signature is still bound to its own document's content hash at the moment of signing,
    and records that it was made under the window opened by proof X — the assurance shown on the
    verification page stays honest;
  - never usable from another device or session, by the AI assistant, or by an API token;
  - the UI shows "Signing unlocked · 4:12 · End now";
  - audited: window opened, each signature under it, window closed.
  New columns on `document_signature` are plain columns, and the assurance vocabulary is enforced
  in the service, not a CHECK — the `13791` rule, exactly as
  `migrations/tenant/14210_signature_passkey.sql` did. Update
  `doc/SIGNATURE_ENGINEERING_GUIDE.md`.

### H. An empty LIVE does not look broken (3.9)

- On LIVE with no operations file yet, the Control Tower shows a short "Getting started" checklist
  instead of a wall of zeros: create a client, invite them to the portal, open the first
  operations file, set the treasury accounts, connect the mailbox, invite the team. Each item
  shows its live state and links to its screen; the checklist disappears once the first file
  exists. Never in TEST.

## Boundaries — other PRs own these

- **PR 1** owns notifications, client documents and KYC, the public website (including Title
  Case) and **lifting `titleCase` out of `financial_dictionary.rules.js` into `packages/shared`**.
  Do not move or change `titleCase`. If PR 1 has merged, import it from its new home.
- **PR 2** owns quote requests and the service-type mode, flow and Incoterms.
- **PR 4** owns quotations / proposals, the costing "By family" view and families, starting a
  quotation from a costing, and the command palette. Your sibling toggle lives in the line
  pickers, not in the families view.
- If a fix truly needs one of those files, keep the hunk minimal and explain why in the PR.

## Rules

- Migrations ONLY in: tenant `14340`–`14379`, platform `0119`–`0124`, seeds `9150`–`9154`. They
  must be idempotent and reversible (the idempotency, reversibility, numbering and
  destructive-migration gates in `scripts/db`). Never renumber an applied migration. A
  re-pricing data fix is a migration or a job that can be re-run safely.
- Never `window.confirm` / `alert` / `prompt`. Use `DateField` / `DateTimeField`, and format
  dates with `lib/format.ts`. Colour comes only from tokens.
- Validation lives in `packages/shared` and is used by both sides (`check:schemas`). The RBAC
  action is `edit`, not `update`.
- Test as a NON-CEO user: the CEO role bypasses `requirePermission`.
- Update every touched module's `<module>.ai.js` under the AI write contract
  (`tests/unit/ai-write-contract.test.js`).
- Regenerate, never hand-edit: `node scripts/generate-api-docs.js` and the API contract
  (`check-api-contract --update`).
- Money is never rounded on the way through: amounts and rates keep their stored precision until
  display.
- Before every push: merge `origin/main`, then run `npm run ci` from the root (the full gate
  list), each frontend app's lint and tests, and the FULL backend jest — never a subset.

## Definition of done (prove each in the PR)

1. EUR → XAF, XAF → EUR, EUR → XOF and XOF → EUR resolve to the parity everywhere, including the
   costing pre-fill; the sync skips them; a hand-entered EUR rate is refused.
2. A manual USD override set yesterday still wins after tonight's feed, until released.
3. Open draft documents priced at 656.168 are re-priced with a note; a sealed costing and a
   posted invoice are unchanged. The PR lists the counts.
4. "Gate-Pass Fee" appears once in every picker; choosing "Billed to the client at cost" stores
   the débours sibling and "Our own cost" the expense sibling; a mismatch is flagged.
5. Creating a line with AI on pre-fills a SYSCOHADA posting on existing accounts, with its
   sources, editable by a non-finance user with create rights; with AI off the form is unchanged.
6. A VAT-inclusive rate stores and shows its HT figure; a costing using it does not add VAT
   twice.
7. Coverage takes countries from the ISO picker; "GB" for a Libreville row is flagged; an
   incomplete row cannot be saved.
8. The CINECAM-style draft (no history) can be deleted; a client with one operations file
   cannot.
9. On a computer without fingerprint, signing offers the phone first; after one confirmation,
   two more costings are approved within 5 minutes with no new prompt, each signature recording
   the window; after 5 minutes, or on another device, a proof is asked again.
10. A LIVE tenant with no operations file sees the go-live checklist; TEST never does.

## The pull request

Open ONE pull request to `main`. The title starts with a Conventional Commits prefix:

```
feat(finance): fixed EUR parity, débours/own-cost toggle, AI-suggested OHADA posting, VAT basis, ISO coverage, draft-client discard, phone signing with a 5-minute window (meeting 6, PR 3)
```

The body follows `.github/pull_request_template.md` and includes a table of register item →
what changed → how it was verified, plus anything not done and why.
