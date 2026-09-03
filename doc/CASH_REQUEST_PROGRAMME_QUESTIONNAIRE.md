# Praxis LS — Cash Request revamp: codebase read & 20-question decision sheet

**Purpose.** The costing module has just been rebuilt (PRs #297–#302): a real worksheet on its own
route, ordered lines, persisted totals, a débours VAT model, an approval snapshot with an amendment
diff, an unlock loop, a sealed document and a per-file uniqueness rule. The cash request is the
money half of that story and it has not had the same treatment.

This document does three things:

1. Reports **what the legacy system actually did** (`view/*/cash-request.php`, 3 242 lines, five
   near-identical departmental copies) and what Praxis LS does **today**, file by file.
2. Names the **structural gaps** between the two and the ask — including three that will silently
   produce wrong numbers if we build on top of them.
3. Asks **20 decision questions**, each with three concrete options and my recommendation, whose
   answers become the engineering guide and the three PRs.

**How to use it.** Answer inline. Where you are happy with my recommendation, write `Rec`. Where you
want something else, tick the letter or write your own. Return the file and I will produce
`doc/CASH_REQUEST_ENGINEERING_GUIDE.md` — migrations, module trees, endpoints, component trees,
acceptance criteria, test plan — split across the three PRs in §5.

---

## 0. What is actually there today

### 0.1 The backend, honestly

`src/modules/costing/cash_request/` — 861 lines across eight files.

| File | Lines | State |
| --- | --- | --- |
| `cash_request.service.js` | 469 | `createDraft` · `updateDraft` · `importCostingLines` · `transition` · `disburse` · `justify` · `get` · `list` |
| `cash_request.rules.js` | 118 | State machine, `disbursementState`, `computeTotals`, `assertMethod` |
| `cash_request.repo.js` | 109 | Header / lines / payments, `costingForImport` |
| `cash_request.validator.js` | 54 | Zod, including the AI-facing schemas |
| `cash_request.routes.js` | 48 | 8 routes, gated |
| `cash_request.controller.js` | 40 | — |
| `cash_request.ai.js` | 18 | AI manifest |
| `cash_request.events.js` | 5 | Event keys |

The lifecycle is real and correct as far as it goes:

```
DRAFT → SUBMITTED → VALIDATED → APPROVED → PARTIALLY_DISBURSED* → DISBURSED → JUSTIFIED
                 ↘ REJECTED   ↙                 (terminal)
```

- **Two approval legs** (10721/10722): `disbursal.requested` (finance validates) and
  `disbursal.validated` (management approves), both bindable to a tenant workflow chain via
  `executor.start`, both landing back through `onApproved.register("cash_request", …)`.
- **Instalments work** (10719). `disburse` takes an optional `amount`, derives the next status from
  `Σ cash_request_payment.amount` under `SELECT … FOR UPDATE`, refuses over-payment rather than
  clamping, and issues **one régie advance per instalment** — which is right, because two payments a
  fortnight apart are two advances with two policy windows.
- **Justification retires the advance** in the same transaction (`regie.retireCore`), so a closed
  request can never sit over an open 581 balance. This was a real ledger defect and it is fixed.
- **Disbursement method** (10746): `CASH | BANK | CHEQUE | MOMO`, with the legacy's per-method
  required fields enforced as a service rule, required at submission.
- **Per-line VAT %** and a **`justification_required`** boolean (10746), with `computeTotals`
  producing Subtotal / VAT / **Total payable** — and `cash_request.amount` correctly being the
  payable, not the HT sum.

### 0.2 The frontend, honestly

- `client/src/features/costing/pages.tsx` — `CashRequestForm` (a `<Modal size="lg">`) and
  `CashRequestsPage` (a `DataList` row with actions) — together ~530 lines inside a 2 056-line file.
- `client/src/features/costing/cash-request-actions.tsx` — 424 lines: `DisburseForm`,
  `JustifyForm`, `CashRequestActions`.

There is **no detail view**. `GET /cash-requests/:id` returns lines, payments and totals, and the
only screen that calls it is the Justify dialog. There is no page a validator can be *sent*. The
costing revamp's own commit message applies verbatim: *"a costing under review is something a
colleague should be able to be SENT — which needs an address."*

### 0.3 What the legacy did that we do not

Read: `doc/reference/legacy_codebase/administration/view/finance/cash-request.php`.

| Legacy | Ours |
| --- | --- |
| `costing_lines_get` refuses anything but `APPROVED_LOCKED` | ✅ same rule, `importCostingLines` |
| Line = `qty` × `unit_cost` × `vat_rate` → `line_total` | ⛔ **one flat `budget_amount`**; the import multiplies qty×unit and throws both away |
| `is_imported` flag per line (imported lines read-only) | ⛔ absent |
| `rejected_by` / `rejected_at`, and **`REJECTED` is editable and re-submittable** | ⛔ `REJECTED` is terminal and records nothing |
| Voucher print: requisitioner grid + **VALIDATED / APPROVED / RECEIVED** signature boxes | ⚠️ three ruled boxes in the template, **no signature engine binding** |
| KPI strip on the list (awaiting validation / awaiting approval / ready to pay / disbursed total) | ⛔ three counts computed client-side from the current page |
| Ops-file linkage stamped back (`cash_request_amount` accumulator) | ✅ deliberately **not** ported — the comma-joined denormalisation is listed in `PROCUREMENT_PORT_LEGACY_ANALYSIS.md` §8 as *do not copy*. Our `cash_request_payment` + `disbursed_amount` is the correct shape. |

And what **neither** system does — the heart of your ask:

> **Nothing anywhere tracks how much of a costing line has already been claimed.**

`importCostingLines` copies label + amount and keeps **no link back to `costing_line`**. Select the
same costing twice and you get the same three lines at their full budget, twice. The legacy had the
same hole. This is the single biggest thing to build.

### 0.4 Three defects worth naming before we design on top of them

**(a) The cash request has no currency.** `costing` carries `currency` + `exchange_rate_to_xaf`
(12766) and every cross-costing sum is required to use `total_ttc_xaf`. `cash_request` has neither
column. Import the lines of a EUR costing and the amounts silently become XAF — the régie advance,
the ledger posting and the voucher all agree with each other and all are wrong. Nothing catches it.

**(b) `justify` writes no actual.** It retires the régie advance and closes the request. It does
**not** write a `cost_entry`. So a fully justified cash request never appears as an ACTUAL against
the file, `cost_tracking` never sees it, and `dossier_reconciliation` (MOD-47 — which is already
named *Operational Cost Reconciliation* in its own header comment) compares an approved budget
against actuals that were booked by a different path entirely. Budget-vs-actual is currently only
correct for spend recorded directly through cost tracking.

**(c) Nothing in the cash chain notifies anyone outside a bound workflow.** `notify-approvals.js`
fires when an approval **task** opens or closes, which requires the tenant to have bound a chain to
`disbursal.requested`. `shared/notifications/notify-events.js` carries a curated `NOTIFIABLE`
allowlist of 30-odd event keys — and **not one `cash_request.*` or `costing.*` key is in it.** So
`cash_request.disbursed`, `cash_request.partially_disbursed` and `cash_request.justified` are
emitted, audited, and reach nobody's inbox.

### 0.5 The permission table as it actually stands

`migrations/tenant/0110_rbac.sql`:

```sql
CREATE TABLE permission (
  role_id, module_key,
  can_create, can_read, can_update, can_delete, can_approve   -- five booleans. That is all.
);
```

`src/middleware/rbac.js` maps friendly actions onto those five, with two standing TODOs in the file:

```js
export:  "can_read",     // TODO: add permission.can_export if this needs to be independent
publish: "can_update",   // TODO: add permission.can_publish if this needs to be independent
```

There is **no `can_validate` and no `can_disburse`.** What exists instead is the **capability
overlay** — and it is considerably more expressive than a boolean:

```sql
CREATE TABLE capability (code CHECK (code IN ('ISSUER','VALIDATOR','APPROVER','LINE_MANAGER')));
CREATE TABLE user_capability (
  user_id, capability_id,
  document_type,        -- per doc type
  min_amount_xaf,       -- amount-banded
  max_amount_xaf
);
```

So today `POST /cash-requests/:id/disburse` is `requirePermission('MOD-49','approve')` **plus**
`requireCapability('APPROVER')`. Q19 is about whether "disburse" becomes a sixth column, a fifth
capability code, or stays as it is.

---

## 1. What the revamp has to deliver

Restating your ask as build targets, so the questions below have something to attach to:

1. **The costing is the project budget.** Select the file → its approved costing's lines load into
   the cash request worksheet, each showing what remains after everything already approved and
   disbursed against it.
2. **No cash without an approved budget.**
3. **Amend the budget through the unlock loop** — which already exists on the costing side (10718)
   and works.
4. **Three signatures:** approver, disburser, receiver.
5. **Partial disbursement must be visible** — it is recorded correctly today but barely surfaced.
6. **A justification-required tick per line**, feeding the compliance engine and, next, OCR.
7. **A real notification engine** for approvals and disbursements.
8. **A permission answer** for disburse/validate/export.
9. **A PDF voucher that mirrors the costing document.**

---

## 2. The questions

Twenty questions, six groups. ⭐ marks my recommendation.

---

### Group A — The budget ledger (the new thing)

---

**Q1. How does a cash request line remember which costing line it came from?**

- **A.** Keep the header `costing_id` only; match imported lines back by `dictionary_item_id`, or by
  label where there is none.
- **B. ⭐ Add `costing_line_id uuid REFERENCES costing_line` to `cash_request_line`**, written by the
  import and null on an ad-hoc line. Consumption is then a `GROUP BY costing_line_id`.
- **C.** A separate `costing_budget_ledger` table — one row per claim against a costing line, written
  on approval and on disbursement.

> **Recommendation: B.** A cannot work: `dictionary_item_id` is nullable on both sides, a costing can
> legitimately carry two lines from the same catalogue item (per-container demurrage — that is what
> `container_type_ref_id` exists for, 0663/D10), and labels are edited. C is the same information
> with an extra table to keep consistent; `cash_request_line` already *is* the claim row, exactly as
> `cash_request_payment` already was the movement row in 10719 — the reasoning in that migration
> ("adding a second table to hold one FK that belongs on an existing row would be redundant
> structure") applies unchanged here. B is one nullable FK, one index, and it makes the "what's left
> on this line" question a query instead of a heuristic.

**Answer:**

---

**Q2. What consumes budget — approved money, or disbursed money?**

Three lines, 150 000 / 2 500 000 / 198 000. Request #1 for the full 2 848 000 is approved on Monday
and 1 000 000 is paid on Tuesday. On Wednesday someone opens request #2 against the same costing.

- **A.** Only cash actually disbursed consumes it. Wednesday shows 1 848 000 remaining.
- **B. ⭐ Approved-and-not-yet-cancelled consumes it (commitment accounting), with disbursed shown
  alongside.** Wednesday shows **0 remaining, 2 848 000 committed, 1 000 000 paid, 1 848 000
  outstanding on request #1.**
- **C.** Anything not in DRAFT or REJECTED consumes it — a submitted request already holds its slice.

> **Recommendation: B.** A is the option that loses money: between approval and payment the budget
> reads as free, so a second request gets approved against headroom the first has already been
> promised, and the file goes over budget with two valid approvals and nobody at fault. C is
> defensible but makes an unreviewed draft-submission block a colleague's legitimate request — the
> requester holds the budget hostage by clicking Submit. B is what every project-budget system does,
> and the display is four columns the reader can reconcile by eye: **Budget · Committed · Disbursed ·
> Remaining**.
>
> This also answers *"can there be several cash requests against one costing?"* — yes, freely. The
> ledger is the guard, not a uniqueness rule. (Unlike the costing itself, which is one-per-file by
> `uq_costing_one_live_per_dossier`.)

**Answer:**

---

**Q3. Where does over-budget stop being a warning and become a refusal?**

- **A.** Refuse at save — a draft line can never exceed its remaining budget.
- **B. ⭐ Warn on the worksheet while drafting and at submission; **refuse at APPROVE**.
- **C.** Warn everywhere, never refuse — the approver is the control.

> **Recommendation: B.** This is the shape the codebase already uses in three places and it is right
> every time: proof obligations are advisory and never throw; over-*disbursement* is refused outright
> because the money has already moved; the ledger refuses a non-postable account but the costing
> tolerates a missing FX quote. The rule is **never block someone recording reality, always block the
> act that releases money.** A blocks a requester from typing what a carrier has actually invoiced,
> which is how spend leaves the system. C means the one control that matters is a human reading a
> number that is not in front of them — so at minimum, if you pick C, the over-budget delta has to be
> a red banner on the approve dialog, not a column.

**Answer:**

---

**Q4. May a cash request carry lines that are NOT on the costing?**

- **A.** No. Cash request lines come from the costing or they do not exist. Unbudgeted spend means
  unlock the costing, amend it, re-approve it, then raise the cash.
- **B. ⭐ Yes, marked `OFF_BUDGET`, requiring a written reason, and surfaced as its own total** on the
  worksheet, the voucher and the approver's screen.
- **C.** Yes, freely, as any other line.

> **Recommendation: B.** A is the pure position and it is the one the costing module already argues
> against in its own comments: *"A file is billed; a week later the carrier sends a detention charge
> because the box sat past its free time… Refusing the unlock left that spend with nowhere to be
> budgeted, which is how it ends up off the file's margin entirely."* The same is true one document
> down. But C makes the budget decorative. B keeps the discipline visible: the approver sees
> `2 848 000 on budget + 120 000 off budget (reason: carrier detention, 4 days)` and decides. It also
> gives you the report that matters — off-budget spend by file, by month, by requester — which is a
> `WHERE costing_line_id IS NULL` once Q1 lands.

**Answer:**

---

**Q5. "No cash without an approved budget" — which gate enforces it?**

- **A. ⭐ An OPS cash request cannot be SUBMITTED without a linked `APPROVED_LOCKED` costing.**
- **B.** It can be submitted, but not APPROVED, without one.
- **C.** It can be approved, but not DISBURSED, without one.

> **Recommendation: A.** The lines *come from* the costing, so a request with no approved costing has
> nothing to be made of — it is not a request that needs a stricter approver, it is an empty form.
> Refusing at submit is also the only option that gives the requester a useful sentence at the moment
> they can act on it ("this file's costing is `SUBMITTED_FOR_APPROVAL` — it needs approving first"),
> which is the shape `COSTING_NOT_APPROVED` already takes in `importCostingLines`. B and C both let
> the request travel to someone else's queue before failing.
>
> **OVH (overhead) is exempt by construction** — it has no operations file, so it can have no
> costing. It keeps its existing gate: a cost centre plus a written justification (`assertContext`).
> Worth confirming you're happy with that asymmetry, because it is the one hole in "no cash without
> an approved budget", and closing it would mean giving cost centres their own periodic budgets — a
> module, not a feature.

**Answer:**

---

**Q6. The costing is unlocked and amended and the budget goes UP (or down). What happens to cash requests already in flight?**

- **A.** Nothing. New headroom simply appears; existing requests are untouched.
- **B. ⭐ Nothing to the requests themselves, but the request records which costing revision it was
  raised against**, and the file's budget bar recomputes against the current revision. A line whose
  budget is amended *below* what is already committed shows as over-consumed (red) rather than
  triggering anything.
- **C.** Amending a line that has live claims against it re-opens those requests for re-validation.

> **Recommendation: B.** `costing_approval_snapshot` already exists (12766) with a `revision` counter
> and the frozen line set, and the amendment diff is already computed and printed. Stamping
> `costing_revision` onto the cash request is nearly free and answers the question an auditor asks:
> *"this was approved against which version of the budget?"* C is the tempting one and it is wrong —
> it means an operations officer adding a detention line to the bottom of a costing re-opens a
> customs disbursement that was approved and paid a week ago. A is B without the audit answer.

**Answer:**

---

### Group B — The worksheet

---

**Q7. Does the cash request get its own route, like the costing sheet?**

- **A.** Keep the `<Modal size="lg">` create form and the row-action pattern.
- **B. ⭐ A full route — `/costing/cash-requests/:id` — on `Record360Page` chrome**, with a `<Dialog>`
  body on phones, exactly mirroring `costing-sheet-360.tsx` (FRONTEND_GUIDE §3.11).
- **C.** A right-hand drawer over the list.

> **Recommendation: B.** You asked for the costing's workflow and worksheet, and this is what that
> means structurally. The same three arguments hold: the request carries a file strip, a line grid, a
> totals block, a payments table and a workflow rail, none of which fits a dialog; a request awaiting
> approval has to be *linkable*; and today `PATCH /cash-requests/:id` exists with **no caller at
> all** — a cash request can be created and never edited, which is precisely the defect the costing
> revamp opened with. C keeps the list context but a drawer cannot be pasted into a message.

**Answer:**

---

**Q8. How do the lines get onto the worksheet?**

- **A.** Today's flow: create the draft, then press "Import costing" as a row action.
- **B. ⭐ Pick the operations file and the lines arrive immediately** — every line of the approved
  costing, each with a checkbox (all ticked), its **Budget / Already claimed / Remaining** figures,
  and the amount **pre-filled to Remaining**. Untick what this request is not for; edit any amount
  down (or up, subject to Q3/Q4).
- **C.** A "Add from costing" picker dialog listing the lines with their remaining balances.

> **Recommendation: B.** This is your description almost word for word, and it is also the pattern
> the costing sheet already established with Suggest — the standard charge set lands *priced*, and
> the user fixes the two numbers nobody could know. A is worse than it looks: it is a second
> round-trip after a save, it silently replaces every line (`replaceLines` deletes and re-inserts,
> which is why proof-obligation flags have to be cleared first), and there is no way to import *some*
> lines. C is the right fallback for the "add one more line from the budget later" case and should
> exist **as well** — but it should not be the primary path.

**Answer:**

---

**Q9. What is a cash request line made of?**

- **A.** Keep `budget_amount` — one number per line.
- **B. ⭐ `qty` × `unit_cost` → amount, plus `vat_percent`**, mirroring `costing_line` and the legacy
  `cash_request_lines`. Add `line_no` for order and `source` (`IMPORTED` / `MANUAL`).
- **C.** qty/unit optional — shown when imported from a costing that had them, hidden otherwise.

> **Recommendation: B.** Three reasons, all concrete. (i) `importCostingLines` currently computes
> `qty × unit_cost` and discards both, so a 4-container line at 62 000 becomes "248 000" and the
> approver cannot see what changed if the count moves to 3. (ii) The CASH_REQUEST PDF template
> already prints QTY and UNIT PRICE columns — it is emitting `qty: 1, unit: budget_amount` on every
> row today. (iii) `cash_request_line` has no `line_no`, so lines read back in `cash_request_line_id`
> order and reshuffle — the exact defect 12766 fixed on `costing_line`. C is a real option if you
> think a cash request is a payment instruction rather than a budget claim, but it makes the
> worksheet's shape depend on its provenance.

**Answer:**

---

**Q10. Currency.**

`cash_request` has no `currency` and no FX rate. A costing in EUR imports as bare numbers.

- **A.** Everything is XAF. Refuse to import from a non-XAF costing, with a clear message.
- **B. ⭐ Carry `currency` + `exchange_rate_to_xaf` on the request**, defaulted from the costing (or
  from `fx_rate_daily` via `currency.rateFor`, as the costing does), and store `amount_xaf` for every
  cross-request sum — mirroring `costing.total_ttc_xaf` and its rule *"the only column any
  cross-costing sum may use"*.
- **C.** Carry currency on the request, but require the disbursement itself to be XAF.

> **Recommendation: B.** This is a latent wrong-number defect, not a feature request: today the
> numbers do not disagree with each other, they are simply all wrong together, which is the kind that
> survives testing. B is a straight copy of a pattern that already exists two files away, including
> its FX fallback behaviour (missing quote ⇒ rate 1 and a logged info, never a blocked sheet). A is
> honest and cheap and I would accept it if you tell me every tenant prices in XAF — but the costing
> module has already decided otherwise, so the two documents would disagree.

**Answer:**

---

### Group C — The chain, and the three signatures

---

**Q11. How are the three signatures captured?**

Today: `validated_by` + `validated_at`, `approver_id` (no timestamp), and
`cash_request_payment.created_by`. The PDF prints three empty ruled boxes. `CASH_REQUEST` is **not**
in `SIGNATURE_CEILING`, so `document_signature.signInternal` refuses it.

- **A.** Keep the printed boxes. People sign the voucher in ink; the scan goes to the vault.
- **B. ⭐ Register `CASH_REQUEST` in the signature ceiling and seal inside the transition**, exactly
  as the costing does (`sealTransition`, best-effort, logged at error, never undoing the decision):
  `VALIDATED` → `ACKNOWLEDGED`, `APPROVED` → `APPROVED_DISPATCH`, `DISBURSED` → a new `DISBURSED`
  reason. Ceiling `{ signable: true, allowsQes: false, allowsWet: true }`.
- **C.** Ask each actor to choose a signature card at the moment they act.

> **Recommendation: B.** The costing revamp already argued this out and the argument transfers: *"The
> button IS the decision… asking them to then choose a signature card is asking the same question
> twice — which is how a control becomes a thing people click through."* The one difference from
> COSTING is **`allowsWet: true`**, because unlike a costing this document leaves the building and
> gets signed by a person receiving cash (see Q12). Not QES: a cash voucher is internal and
> certification is bought per envelope from a third party.

**Answer:**

---

**Q12. Who is "the one who receives", and how is that third signature actually collected?**

- **A. ⭐ The régie holder** — the system user the advance is issued to (`holder_user_id`, defaulting
  to `requested_by`). They acknowledge receipt in-app, which stamps `received_by` / `received_at` and
  seals. If the beneficiary is a third party, the holder is the one who took the cash and is
  accountable for it; paying the third party is the *spend*, evidenced at justification.
- **B.** The `beneficiary` — who may be external — signs through the verification-portal link, like a
  counterparty on a delivery note.
- **C.** Wet only: print, sign, scan back into the vault against the request.

> **Recommendation: A as the default, with C always available.** A is the only one that is true to
> the ledger: `Dr 581 régie (holder) / Cr treasury` places the money in **the holder's** hands, and
> `regie.retireCore` later reconciles against **the holder's** receipts. Making the external
> beneficiary the signer would attest the wrong fact and would leave the aging clock pointing at
> someone with no login. B is the right mechanism for the *supplier's* receipt — which is the
> justification document, and belongs to OCR (Q18), not here. C stays because a cash window at 06:00
> is a paper transaction and always will be.
>
> Schema: `received_by`, `received_at`, `received_ack_kind` (`IN_APP` / `WET_SCAN`) on
> `cash_request_payment` — **per instalment**, not per request, because each tranche is physically
> handed over separately.

**Answer:**

---

**Q13. Should disbursement itself be bindable to an approval chain?**

Today `disburse` is `requirePermission('MOD-49','approve')` + `requireCapability('APPROVER')`, with
no `executor.start` — unlike SUBMITTED and VALIDATED, which each open a chain.

- **A.** Keep it as-is. Two approval legs are enough; the treasury acts on an approved request.
- **B. ⭐ Add a `disbursal.approved` approvable event** so a tenant *can* bind a treasury chain
  (e.g. amounts over 5 000 000 need the finance director), **with no chain bound by default** — so
  nothing changes for anyone who does not want it.
- **C.** Route disbursement through the régie module's own gates only.

> **Recommendation: B.** The cost is one seed row and one `executor.start`; the `onApproved` handler
> already dispatches on current status. It gives the amount-banded control the capability table was
> built for (`user_capability.min_amount_xaf` / `max_amount_xaf`) without hard-coding a threshold.
> And "no workflow bound → autoApproved, manual path stays available" is an established pattern here
> (W8) so B is strictly a superset of A. C would put the money control in the module that posts the
> ledger rather than the one holding the approval, which inverts the current split.

**Answer:**

---

**Q14. Rejection.**

`REJECTED` is terminal (`NEXT.REJECTED = []`) and stores no reason, no actor, no timestamp. The
legacy stored `rejected_by`/`rejected_at` and let a `REJECTED` request be **edited and re-submitted**
(`pr_save` accepts `DRAFT` and `REJECTED`; `pr_transition` SUBMIT accepts `from ∈ {DRAFT, REJECTED}`).

- **A.** Keep it terminal. A rejected request is dead; raise a new one.
- **B. ⭐ Add `rejected_by` / `rejected_at` / `rejection_reason` (required)** and allow
  `REJECTED → DRAFT` so the requester can fix and resubmit, keeping the document number and the
  history.
- **C.** Rejection spawns a linked successor draft, pre-filled, leaving the rejected one intact.

> **Recommendation: B.** A means a mistyped MoMo number costs a whole document and its number, and
> the approver's reason lives nowhere — a rejection today is a status with no explanation, which is
> the one thing a requester actually needs. This mirrors the costing's unlock loop, which made a
> written reason a **column** rather than a remarks blob for exactly this reason. C is cleaner for
> audit but doubles the document count on a document type that is raised several times per file.

**Answer:**

---

### Group D — Partial disbursement

---

**Q15. Instalments: what is shown, and how is an under-disbursed request closed?**

Recorded correctly today (`cash_request_payment` + derived status); surfaced as a single
`disbursed_amount` and a callout in the Disburse dialog.

- **A.** Surface it properly — a payments table (date, amount, method, treasury account, advance
  ref, who paid, who received), a progress bar, and `PARTIALLY_DISBURSED` in the KPI strip — and
  leave a part-paid request open indefinitely.
- **B. ⭐ All of A, plus a `CLOSE_BALANCE` action** (permission `approve`) that closes the request at
  what was actually paid, requires a reason, and **releases the unpaid commitment back to the costing
  budget**.
- **C.** All of A, plus auto-close after a configurable number of days.

> **Recommendation: B.** Under Q2's commitment model, A has a slow leak: a request approved for
> 2 848 000 and paid 1 000 000 that everyone has moved on from holds 1 848 000 of budget forever, and
> the file reads as fully committed against cash that will never move. B is the deliberate human act
> that fixes it, and it is the same shape as the régie module's existing `write-off` and `unage`
> (`approve`-gated, reason required). C automates a decision about money with no human in it — the
> régie policy window is already the one place that is acceptable, and there it only *reclassifies*,
> it never closes anything.
>
> Sub-question worth an explicit answer: should each instalment be **allocated across lines**? My
> recommendation is **no** — a treasury window pays a tranche, not a per-line breakdown, and the
> line-level truth arrives at justification where it is evidenced. Budget consumption stays at the
> **approved** line amounts (Q2) and is trued up at close.

**Answer:**

---

### Group E — Justification, compliance, and the road to OCR

---

**Q16. The "justification required" tick — who decides, and what does it gate?**

`cash_request_line.justification_required` exists (10746) as a free boolean nothing reads.
Separately, `dictionary_item` declares `receipt_requirement` (`ALWAYS_REQUIRED` / …),
`requires_justification` and `proof_source` (0630), consumed by
`services/compliance/proof-obligation.service.js` — which is **advisory by design and never throws**,
and says so three times in its own header.

- **A.** Purely manual — the requester ticks the box.
- **B. ⭐ Defaulted from the dictionary item and editable UP but not DOWN**: an item the catalogue
  marks `ALWAYS_REQUIRED` renders the control **disabled with the reason shown** (not hidden); any
  other line can be ticked by the requester or the approver.
- **C.** Purely from the catalogue — no per-line control at all.

> **Recommendation: B.** This is the exact rule the costing line grid already applies to VAT and
> nature, and the comment there is the argument: the legacy defaulted a VAT box to ticked and the
> supplied sample sheet shows `#-1047 Customs Duties & Taxes` charged 19.25% VAT — on a customs duty.
> Catalogue decides, user may be stricter, the control that would contradict the catalogue is
> disabled with its reason visible rather than hidden. A lets someone un-require a receipt the
> business always requires; C removes the approver's ability to say "bring me a receipt for this one".

**Answer:**

---

**Q17. A justification-required line has no supporting document. Where is that advisory, and where is it a refusal?**

- **A.** Advisory everywhere, as today — a WARN `compliance_flag` and a notification to the
  requester, never a block.
- **B. ⭐ Advisory through submit / approve / disburse; **blocking at JUSTIFIED**.** The money is
  never held up; the request cannot be *closed* while a required receipt is missing.
- **C.** Blocking at disbursement — no receipt promised, no cash.

> **Recommendation: B.** C is the option the proof-obligation service exists to argue against, and it
> is right: *"A freight forwarder pays a port authority in cash at 06:00 and gets the paperwork at
> 11:00; a system that refuses the disbursement until the receipt exists does not produce more
> receipts, it produces disbursements recorded outside the system."* But A has the opposite problem —
> nothing ever forces the receipt to arrive, and the open flag is the only trace. B puts the wall at
> the only place where the paperwork is genuinely late rather than merely not-yet-arrived, and it is
> the wall the OCR module needs to be able to trust. Note `justify` already refuses on an uncleared
> advance (`ADVANCE_NOT_CLEARED`), so the precedent for "closing is where it gets strict" is set.

**Answer:**

---

**Q18. The seam into OCR (Budget vs Actual). What does justification write?**

Today `justify` writes `spent_amount` on the lines and retires the advance. It writes **no
`cost_entry`**, so justified cash never appears as an actual anywhere.

- **A.** Leave it. OCR reads `cost_entry` and spend is expected to be recorded through cost tracking
  separately.
- **B. ⭐ Justification writes one `cost_entry` per spent line**, tagged with `dossier_id`,
  `dictionary_item_id`, `proof_vault_id`, and new columns `cash_request_line_id` +
  `costing_line_id` — so budget-vs-actual becomes a **join**, not a fuzzy match.
- **C.** OCR reads `cash_request` directly alongside `cost_entry`.

> **Recommendation: B.** A is the status quo and it means the same spend must be entered twice, or
> the file's actuals are simply incomplete — and `dossier_reconciliation.buildLines` currently drops
> any actual with no `dictionary_item_id` into an `UNMATCHED` bucket for a human to map by hand. That
> whole bucket largely disappears if cash-request justification writes properly tagged actuals. C
> makes OCR read two sources with different shapes and reconcile them itself, which is the work B
> does once, upstream, where the facts are known. **This is the decision that determines how much of
> the OCR module is left to build** — it is worth thinking about hardest.

**Answer:**

---

### Group F — Permissions, notifications, paper

---

**Q19. The permission vocabulary: Create · Read · Update · Delete · Export · Approve · Validate · Disburse?**

- **A.** Add three boolean columns to `permission`: `can_export`, `can_validate`, `can_disburse`.
  Eight-column matrix, one grid, everything visible in one place.
- **B. ⭐ Add `can_export` only, and express validate/disburse as CAPABILITIES** — add `DISBURSER` to
  the `capability` code CHECK alongside `ISSUER` / `VALIDATOR` / `APPROVER`, and gate
  `/disburse` on `requireCapability('DISBURSER')` (with a migration granting it to everyone who holds
  `APPROVER` today, so nothing breaks).
- **C.** Change nothing. `approve` + `APPROVER` already gates disbursement.

> **Recommendation: B**, and the split is the whole point:
>
> - **Export is a permission.** It is a right over *data* — the ability to take a module's contents
>   out of the building — and it does not follow from read. A junior accountant may legitimately read
>   payroll on screen and not be allowed to download it as a spreadsheet. It is per role × module,
>   it has no amount and no document type, and it is a boolean. It belongs in `permission`, and
>   `rbac.js` has carried the TODO since it was written.
> - **Validate and disburse are separations of duty.** They are *not* naturally per-module booleans,
>   because the real-world rule is "Marie may disburse cash requests up to 500 000; above that it is
>   the finance director" — and `user_capability` already carries `document_type`,
>   `min_amount_xaf` and `max_amount_xaf` to say exactly that. A boolean column can never express
>   it, so A would ship a control that looks complete and quietly cannot encode the policy you
>   actually run. `VALIDATOR` already exists and is already what the SUBMITTED→VALIDATED leg means.
> - C is defensible but conflates "may approve a cash request" with "may hand over cash", which is
>   the one pair maker-checker most wants separated: the manager who approves the spend should not be
>   the cashier who releases it.
>
> Cost of B: one column + one enum value + one backfill + the matrix UI gaining a sixth letter
> (`client/src/lib/rbac.ts` `PERMS` / `PERM_LABEL` / `PERM_TITLE` and the matrix page's colour map)
> and the capability screen gaining a fourth card.

**Answer:**

---

**Q20. Notifications — who hears what, and on which channel?**

Infrastructure that already exists and works: per-user × per-category × per-channel preferences
(in-app / email / push), a `notify()` producer that batches recipient resolution, categories with
`approvals` and `finance` buckets, RBAC-resolved audiences, and `notify-approvals.js` for chain
events. What is missing is that **no `cash_request.*` or `costing.*` key is in the `NOTIFIABLE`
allowlist**, so outside a bound workflow chain nothing is ever sent.

- **A.** Targeted only. Notify the **named individuals** on the path: submit → the finance
  validators; validate → the approvers; approve → the requester and the cashiers; disburse → the
  requester and the receiver; justify → the requester. Nobody else, ever.
- **B. ⭐ A, plus the money events broadcast to the module audience** — add
  `cash_request.approved`, `.partially_disbursed`, `.disbursed`, `.justified` and
  `costing.approved` to `NOTIFIABLE` with `action: "view"`, category `approvals`
  (`DOMAIN_TO_CATEGORY` already maps `cash_request` and `disbursal` to `approvals`), so anyone with
  MOD-49 view sees the file's money moving in their inbox and can mute the category.
- **C.** B, plus a daily digest of everything awaiting the reader's decision and every advance past
  its policy window.

> **Recommendation: B, with C as a fast-follow.** A is safe and is the floor. The reason to go to B
> is that "who was paid what against my file" is genuinely something operations and finance want to
> see without being on the approval path, the audience is already RBAC-scoped so it cannot leak, and
> every recipient can already turn the whole category off — which is what makes broadcasting safe
> here and not in, say, mail. C is where this should end up (an aging régie advance nobody is looking
> at is the actual failure mode the OHADA KB §6.8 warns about) but it needs a scheduled job and is
> better as its own change than bolted onto this one.
>
> Sub-decision, please answer inline: **should approval and disbursement notifications default email
> ON, or in-app only?** My recommendation is **in-app by default, email opt-in — except a rejection,
> which is HIGH priority and emails** (the pattern `notify-approvals.onOutcome` already sets).

**Answer:**

---

**Q21 (bonus — the paper). Should the voucher mirror the costing document?**

The `CASH_REQUEST` template is already good: letterhead from the tenant entity, method details
printed so the cashier pays against what is written, Subtotal / VAT / **TOTAL PAYABLE**, and the
legacy's three signature boxes. What it lacks relative to the rebuilt `COSTING` document is: real
seals (Q11), the requisitioner grid, the **payments table**, the budget-consumption columns, and the
amendment-style "what this claims against the budget" block.

- **A.** Leave it. It prints the facts.
- **B. ⭐ Bring it to costing parity**: seals in place of ruled boxes where they exist (ruled boxes
  as the fallback, as the costing does), the requisitioner grid, a **Budget / Claimed / This request
  / Remaining** column set on each line, the payments table once anything is paid, and the
  off-budget total called out.
- **C.** B, plus a separate one-page **payment receipt** document per instalment, signed by the
  receiver.

> **Recommendation: B, and I would take C too if you want the receiver's ink on something.** The
> voucher is the document a beneficiary signs and a cashier pays against, so the budget columns
> matter on paper for the same reason the amendment diff does on the costing: whoever signs should
> see what this claim does to the file. C is genuinely useful where cash is handed over at a window
> in tranches — but say so now, because it is a fifth registry entry, not a variant of the fourth.

**Answer:**

---

## 3. Things I recommend we do NOT do

Stated so they are decisions rather than omissions.

1. **Do not stamp cash-request totals back onto the operations file.** The legacy accumulated a
   comma-joined `cash_request_id` string and a running `cash_request_amount` on
   `operations_file_master`. `PROCUREMENT_PORT_LEGACY_ANALYSIS.md` §8 item 2 already lists this as
   *do not copy*. The file's money view derives from the children.
2. **Do not add a "paid" status derived from a cache.** Same doc, §8 item 4. `disbursed_amount` is a
   **derived cache recomputed from the payment children**, never incremented — and the status is
   derived from it by `disbursementState`. Keep that rule when the budget ledger lands.
3. **Do not make the proof check block disbursement.** See Q17.
4. **Do not build a separate budget table** if Q1 lands as B. One FK, one index.
5. **Do not hard-code any account, threshold or role name.** `accountFor(client, 'treasury')`,
   `user_capability` bands, and tenant-bound workflows already cover all three.

---

## 4. Open risks I want you to see

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| **Currency (§0.4a)** | A non-XAF costing silently produces wrong cash, wrong advance and wrong posting | Q10 |
| **No actual is written at justification (§0.4b)** | Budget-vs-actual is incomplete *today*, and OCR is built on it | Q18 |
| **`replaceLines` deletes and re-inserts** | Every line gets a new id on every save; proof-obligation flags are cleared and re-raised to compensate. With `costing_line_id` and instalment history attached, this becomes lossy | Move to a diff-based upsert keyed on `line_no` — I would fold this into PR 1 |
| **`REJECTED` is terminal (§0.3)** | A typo costs a document number and the reason is nowhere | Q14 |
| **`approver_id` has no timestamp** | The costing has `approved_at`; the cash request does not, so "when was this approved" is only answerable from the audit ledger | Fold into PR 1 |
| **The list KPI strip is computed client-side from one page** | It is wrong the moment there are more than 50 requests | A `GET /cash-requests/kpis` endpoint, as `costing.kpis` already is |

---

## 5. Proposed three PRs

Sequenced so each one is independently shippable and nothing is half-built between them.

### PR 1 — The budget ledger and the record (backend + schema)

*Migration `12770_cash_request_budget.sql`* — `costing_line_id`, `qty`, `unit_cost`, `line_no`,
`source` on `cash_request_line`; `currency`, `exchange_rate_to_xaf`, `amount_xaf`,
`costing_revision`, `approved_at`, `rejected_by/at/reason` on `cash_request`; `received_by/at/kind`
on `cash_request_payment`; `REJECTED → DRAFT` and `CLOSE_BALANCE` in the status CHECK.

Service: budget-consumption read (`GET /costings/:id/budget`), import that carries provenance and
defaults to Remaining, over-budget checks at the gates chosen in Q3, off-budget handling (Q4),
`CLOSE_BALANCE`, rejection with a reason, diff-based `replaceLines`, `GET /cash-requests/kpis`.
Tests: budget consumption across several requests; over-budget refusal; instalments unchanged;
rounding.

### PR 2 — The worksheet, the chain and the notifications (frontend + workflow)

`cash-request-360.tsx` on `Record360Page`; a line grid with the Budget / Claimed / Remaining columns
and the justification tick; the file→costing→lines flow; a payments table with a progress bar; the
disburse and receive dialogs; the workflow rail. `disbursal.approved` event + seed (Q13). The
`NOTIFIABLE` entries and the notification wiring (Q20). `can_export` + `DISBURSER` (Q19) with the
matrix and capability screens. Tests: the 360 render, the actions each status offers, the RBAC
shape.

### PR 3 — Signatures, the document, and the OCR seam

`CASH_REQUEST` in `SIGNATURE_CEILING` + a `signature_policy` seed; `sealTransition` on validate,
approve, disburse and receive; the rebuilt voucher (Q21) with seals, requisitioner grid, budget
columns and payments table; `justify` writing tagged `cost_entry` rows (Q18); the compliance
gate at close (Q17). Tests: the seal at each transition, the document snapshot, the actual written
per justified line.

---

## 6. Answer summary (fill this in and send it back)

| Q | Topic | Your answer |
| --- | --- | --- |
| 1 | Line ↔ costing_line link | |
| 2 | Budget consumed by committed or disbursed | |
| 3 | Over-budget gate | |
| 4 | Off-budget lines | |
| 5 | Approved-costing prerequisite | |
| 6 | Costing amendment vs in-flight requests | |
| 7 | Worksheet route | |
| 8 | Line seeding UX | |
| 9 | Line shape (qty × unit × VAT) | |
| 10 | Currency and FX | |
| 11 | Signature capture | |
| 12 | Who receives | |
| 13 | Disburse as a bindable chain | |
| 14 | Rejection | |
| 15 | Partial disbursement + close balance | |
| 16 | Justification tick source | |
| 17 | Missing receipt: where it blocks | |
| 18 | The OCR seam | |
| 19 | Permission vocabulary | |
| 20 | Notifications (+ email default) | |
| 21 | The voucher | |

---

## 7. Appendix — how this document was verified

Every factual claim above was read out of the tree, not recalled. This appendix says what was read
and, more importantly, **what was not** — so you can weigh the recommendations accordingly.

### 7.1 Read in full

| File | Lines |
| --- | --- |
| `src/modules/costing/cash_request/*.js` (all 8) | 861 |
| `src/modules/costing/costing/costing.service.js` | 652 |
| `src/modules/costing/costing/costing.routes.js` | 67 |
| `src/middleware/rbac.js` | 256 |
| `src/services/workflow/notify-approvals.js` | 90 |
| `src/shared/notifications/notify-events.js` (the whole `NOTIFIABLE` allowlist) | 136 |
| `src/shared/notifications/categories.js` (`DOMAIN_TO_CATEGORY`) | ~110 |
| `client/src/features/costing/cash-request-actions.tsx` | 424 |
| `client/src/lib/rbac.ts` (PERMS / labels) | ~70 |
| `migrations/tenant/10719_cash_request_partial_disbursement.sql` | 160 |
| `migrations/tenant/10746_cash_request_method_vat.sql` | 66 |
| `migrations/seeds/9097_seed_cash_request_partial_event.sql` | 29 |
| `doc/reference/legacy_codebase/.../finance/cash-request.php` §§1–9 (the whole PHP half: all six AJAX endpoints, the print voucher, the signature grid) | ~960 + print block |

### 7.2 Read in the relevant part

`costing.repo.js`, `costing-lines.tsx`, `costing-sheet-360.tsx`, `costing-api.ts`,
`pages.tsx` (the cash-request and costing sections), `file-360.tsx` (money + people tabs),
`document_vault.types.js` (`SIGNATURE_CEILING` + doc-type registry), `template.service.js`
(the `CASH_REQUEST` and `COSTING` projections), `templates/registry.js` (both templates and
`LINE_COLS`), `proof-obligation.service.js`, `dossier_reconciliation.service.js`,
`cost_tracking.service.js`, `regie.routes.js`, `signatures/presets.js`, `workflow/executor.js`,
`migrations/tenant/0110_rbac.sql`, `0342_finance_gaps.sql`, `0320_costing_procurement.sql`,
`12766_costing_foundation.sql`, `10721`/`10722`, `doc/OHADA_KB.md` §§6.7–6.8 and §7–8.2,
`doc/PROCUREMENT_PORT_LEGACY_ANALYSIS.md` §§6.7–8, `doc/PERMISSION_SWEEP_BACKLOG.md`.

### 7.3 Each load-bearing claim, and the command that proves it

| Claim (§) | Verified by |
| --- | --- |
| `cash_request` has **no** `currency`, `exchange_rate_to_xaf`, `approved_at`, `rejected_by/at/reason` (§0.4a, §4) | `grep -rn "ALTER TABLE cash_request" migrations/tenant/*.sql` + `0342` `CREATE TABLE` — the complete column set is 0342 + 10719 + 10721 + 10722 + 10746, and none adds them |
| `cash_request_line` has **no** `costing_line_id`, `qty`, `unit_cost`, `line_no`, `is_imported` (§0.3, Q1, Q9) | same; the table is `budget_amount, spent_amount, is_disbursement, proof_vault_id` + `vat_percent, justification_required` |
| `justify` writes **no** `cost_entry` (§0.4b) | Full read of `cash_request.service.js:justify` — it calls `replaceLines`, `checkProof`, `regie.retireCore`, `repo.update`, `audit`. Nothing else. |
| **No** `cash_request.*` / `costing.*` key is in `NOTIFIABLE` (§0.4c) | Full read of the allowlist — 30 keys, none from either domain |
| `CASH_REQUEST` is **not** in `SIGNATURE_CEILING` (Q11) | Full read of the object: 8 entries, `COSTING` is the last, `CASH_REQUEST` absent → `signaturePolicyFor` returns `NOT_SIGNABLE` |
| `PATCH /cash-requests/:id` has **no** client caller (Q7) | `grep -rn "cash-requests/\${" client/src` → 5 hits: `/import-costing`, `/transition`, `/:id` (GET), `/disburse`, `/justify`. No PATCH. |
| `permission` has exactly five booleans; no `can_export` / `can_validate` / `can_disburse` anywhere (§0.5, Q19) | `grep -n "can_" migrations/tenant/0110_rbac.sql` + `grep -rn "can_export\|can_validate\|can_disburse" migrations/ src/ client/src packages/` → only the two TODO comments in `rbac.js` |
| `receipt_requirement` / `requires_justification` / `proof_source` live in **0630** (Q16) | `grep -rln "receipt_requirement" migrations/tenant/` → `0630_financial_dictionary_360.sql`, sole hit. (0631 added the `compliance_flag` dimensions, which is a different thing — corrected in this document.) |
| The CASH_REQUEST PDF emits `qty: 1, unit: budget_amount` into real QTY/UNIT columns (Q9) | `template.service.js` `CASH_REQUEST` branch, line mapping; `registry.js` `LINE_COLS` carries `qty` and `unit` |
| The five legacy departmental copies share **one** implementation (§0.3) | `diff` of lines 1–960 (the whole PHP/AJAX half): finance vs operations/management/sales = **0** differing lines; vs admin = 24, all avatar handling. Divergence is sidebar markup only. |
| Legacy `REJECTED` was editable and re-submittable (Q14) | `pr_save`: `if (!in_array($curStatus, ['DRAFT','REJECTED'], true)) → 409`; `pr_transition` SUBMIT: `if (!in_array($from, ['DRAFT','REJECTED'], true)) → 409` |
| Legacy tracked no per-costing-line consumption (§0.3) | `grep -in "already\|remaining\|balance\|deduct\|disbursed_total"` across all 3 242 lines — every hit is header-level `amount_total − disbursed_total`. No line-level anything. |
| Next free migration number is 12770 (§5) | `ls migrations/tenant | tail` → highest is `12769_containers_per_box_shipping.sql` |

### 7.4 What I did NOT verify, and where I am inferring

Stated plainly, because these are the places a recommendation could be built on sand:

1. **I did not run anything.** No migration was applied, no test suite executed, no server started.
   Every claim is static reading. If a runtime behaviour contradicts a code path I have described,
   the runtime is right.
2. **I did not read the archived legacy copies** (`view/archive/*`, `view/*/archive/*`,
   `public_html/.../admin/cash-request.php` — the last is 1 647 lines, roughly half the size, and is
   an older revision). If an older revision had budget-consumption logic that was later removed, I
   have not seen it. Say so and I will read them before the guide.
3. **I have not seen the legacy database schema.** `cash_request_master` / `cash_request_lines` /
   `cash_request_payments` columns are inferred from the SQL inside the PHP, which is complete for
   every column those queries touch but silent about any column they do not.
4. **The tenant seed data is unverified at runtime.** Whether any given tenant actually has a
   workflow bound to `disbursal.requested` / `disbursal.validated` depends on whether `0492`/`10722`
   found roles to bind to — both migrations `RAISE WARNING` and continue if they did not. I have read
   the migrations; I have not inspected a live tenant.
5. **Q2's commitment model is a design judgement, not a finding.** Nothing in either codebase
   implements budget consumption, so there is no precedent to be faithful to. The recommendation is
   argued from the failure mode (two valid approvals against one pot), not read off the tree.
6. **Q12's "the holder is the receiver" is an accounting reading**, from OHADA KB §6.8 and the
   `Dr 581 / Cr 521` posting `regie.issue` performs. If in your practice the beneficiary signs the
   voucher and the holder is a courier, that inverts the recommendation — tell me.
7. **Effort estimates are absent on purpose.** I have not sized the PRs beyond sequencing them.
