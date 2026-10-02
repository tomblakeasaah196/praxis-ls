# Tenant review — meeting 7 (1 Oct 2026): findings verified against the code

**Source.** Google Meet transcript + Gemini notes of meeting 7 with Timothée Massomba (MD of
SMART Logistics & Services Ltd, the first and only tenant), presented by Tom Blake (JBS Praxis).
Agenda, in Tom's words at 00:00:02: "today we'll be reviewing service types and VAT … and tax and
jurisdictions actually. So we are about getting the client online." Every item below was checked
against `main` at `98c3a9c`. Items marked **[Meeting]** were raised in the meeting;
**[Found]** were found while verifying them and were not raised by anyone.

The whole of this register is implemented by the single PR on branch `ccr-71fa323f-4dfn5w`.

---

## 0. Reading the transcript — what the transcription got wrong

| Transcript says | Means |
| --- | --- |
| "petit papa" | Timothée Massomba (the tenant) |
| "ultra", "old year", "old" | **Autre** — the OTHER tax-family tab |
| "Pavia X4", "PV X4" | **TVA** (a VAT code being amended as a demo) |
| "exportation KVI" | **TVA export** — zero-rated |
| "IRP", "IRP bar", "CJRP bar" | **IRPP**, and its *barème* (the progressive scale) |
| "CC on PPP" | **CAC** on IRPP — the 10% communal surtax |
| "regime real", "regime simpl" | *régime réel* / *régime simplifié* |
| "sim additional", "commino" | *centimes additionnels communaux* (CAC) |
| "capped at 750 2.5" | capped at **750,000** |
| "35 to 20" | **35%** (the top IRPP band) |
| "a general assoc" | *acompte* / *précompte* — withholding at source |
| "project break bulk", "project B", "chhatter" | **PROJECT_CARGO**; *charter* |
| "physibility", "visibility", "a tree of visibility, a reconnaissance" | **FEASIBILITY** (`Étude de faisabilité et reconnaissance`) |
| "plan deliverance", "lift plan" | **METHOD_STATEMENT** (`Plan de levage`) |
| "space boot", "crane loed" | lowbeds / cranes — **EQUIPMENT_BOOKED** |
| "C freight import" | **SEA_FREIGHT_IMPORT** |
| "document expedition vera" | shipping-documents verification step |
| "the classion go" | the *discharge* / cargo steps being re-weighted |
| "the model", "this model" | the **modal** (the dialog) |
| "publish new this thing" | **Publish new version** |

## 1. Not bugs — do not build

- **The tax RATES themselves.** Checked line by line against the CGI and the 2026 Finance Law.
  Withholding 2.2% (réel) / 5.5% (simplifié) / 15% (non-resident); IS 33% = 30% + 10% CAC; CNPS
  7% family capped at 750,000; CAC 10% of IRPP; the 30% professional allowance with a 500,000
  annual cap — all correct in `migrations/seeds/9010_seed_tax.sql`. Tom's own "the only one that
  needs to be verified is this IRP bar" (01:20:56) also checks out.
- **The IRPP barème is right, and Tom's spoken description was the loose one.** He said "your
  first 2 million … your second 3 million … your third 5 million" (01:22:25), which sounds like
  band *widths* summing to 10M. The seeded table reads `upto` as a cumulative **ceiling** —
  0–2M at 10%, 2M–3M at 15%, 3M–5M at 25%, above 5M at 35% — which is the CGI scale. No change.
  *(Guarded now: `tests/unit/payroll-rates-from-tax-codes.test.js` asserts the seeded table and
  the engine's own default produce identical tax at six income levels, so the two cannot drift.)*
- **Versioned rates work.** The amend-rate demo at 01:18:01 ("from the 1st of January to the 20th
  of September it was zero, then 21st to 30th it moved to 7.5, and now it has gone back to zero")
  is `supersedeCode` behaving exactly as designed — atomic expire-and-open, history preserved.
- **The mobile bottom bar.** Timothée: "the modules they are named properly very interesting"
  (01:30:57). Monitor / Configure / Empower / Engage / Fulfil / Transact render as described;
  everything else he hit was his own VPN and antivirus, and Tom's network.
- **The PROJECT_CARGO chain.** The 14 stages Tom read out — feasibility and route survey, lift
  plan, abnormal-load permits, cranes/lowbeds, cargo insurance, loading at origin, export
  clearance, main carriage — are seed `9091` as shipped, correctly weighted to 100.
- **"Why is the accounting in French?"** (01:26:51, asked twice.) Tom: "it's very difficult for
  you to have accounts in English … they have translations that are not very accurate." Accepted
  as an owner decision — see **D3**. The plan comptable stays French; everything that is not an
  account label does not.

## 2. Actions that are not code

- Tom: the IRPP barème and the twelve repaired account mappings (3.1) want an
  expert-comptable's eye before go-live. The rates are referenced; the mappings are now explicit
  and visible on screen, which is what makes that review possible at all.

---

## 3. Findings

### 3.1 [Meeting] Twelve of twenty-one seeded tax codes could not post

Tom, live on the screen at **01:25:15**:

> "oh I think there's a problem here, it doesn't write the accounts it posts to, that means
> accounts to be debited and credited … let me check for others … ah it has the credit account,
> which is … that's okay, debit accounts none … the CFC one national, credit account none. So
> I'll ensure that every account is actually mapped to their account."

Verified in `migrations/seeds/9010_seed_tax.sql`:

- **Nine had one side NULL.** No debit: `TVA_STD`, `TVA_STD_SALES`, `TVA_EXPORT`, `IRPP`,
  `CAC_ON_IRPP`, `CFC_EE`, `CNPS_PENSION_EE`. No credit: `TVA_INPUT_PURCH`,
  `TVA_INPUT_TRANSPORT`.
- **Three pointed at a non-postable HEADING,** which is worse than NULL because it looks mapped:
  `SIT_NONRES` at `62` (`Services extérieurs A`, `is_postable = false`,
  `migrations/seeds/9000_seed_coa.sql:34`) and `447` (line 68); `IS_MIN_REEL` / `IS_MIN_SIMPL`
  crediting `521` (`Banques`, line 77). The screen's own picker loads **postable** accounts only
  (`loadPostableAccounts`), so those three values were not even selectable in the UI that
  maintains them — re-saving the code silently cleared them.

**Why no test caught it.** `determination.compute` reads ONE side per context — the credit on a
sale, the debit on a purchase (`src/services/accounting/determination.js:76,86`) — and takes the
counterpart from the document. So the invoice path posted correctly from a half-written rate card
and every test about it stayed green, while the tax screen, the payroll posting, the declaration
pack and anyone checking the mapping before go-live all read "none".

### 3.2 [Meeting] A milestone stage's English name was not editable

Tom at **01:38:25**, mid-demo:

> "It doesn't give you the possibility of changing the English name. It gives you just the French
> name. So ensure that when we are creating it permits us change both English and French names.
> That's uh something we should take note of. It's a gap in the UI."

`client/src/features/masterdata/service-type-template-form.tsx`: `label_fr` was an input on the
summary row; `label_en` was inside the `▸` expander, one click out of sight. A field a bilingual
tenant does not see is a field they do not fill in, and an empty `label_en` is what an
English-reading desk then reads a French stage name from.

### 3.3 [Meeting] The chain dialog was too narrow to hold both names

Tom at **01:55:13**: "we make this model a bit larger so it can accommodate all of that. So if the
model can cover probably full width also or maybe close to full width that would be a good idea.
So we can see the full English name, full French name. Uh we see this code here."

`size="xl"` is `max-w-3xl` — 768px (`client/src/components/ui/dialog.tsx:100`). Two labels, a
code, a weight and an owner do not fit in it, which is why the English label ended up behind an
expander in the first place. 3.2 and 3.3 are one problem.

### 3.4 [Meeting] Milestone owners could not be added

Tom at **01:56:14 → 01:57:20**, having reached the stage-owner dropdown:

> "it's good to put uh like the party that is directly involved in the operation and I think we
> should even have the possibility of adding more parties here so if it's not amongst this listed
> here … we should have the possibility of adding. So maybe under milestones, let me see if we
> already have it. No, we don't have that. So we're going to have a settings button, a
> configurations button that will permit us to create new uh create new milestone owner … the
> owners uh category something like that."

The five values were hardcoded in **four** places at once: a zod enum
(`milestone.validator.js:5`), a CHECK on `milestone_template_stage.owner_tier`
(`0650_milestone_engine.sql:91`), a CHECK on `milestone_instance.owner_tier` (line 163), a third
on `milestone_instance.attributed_to` (line 168), and `OWNER_TIERS` in the client
(`operations-api.ts:1043`). Freeing one and leaving another is worse than leaving all four — the
chain publishes and the dossier then fails to instantiate.

**[Found] the cost of the gap is in the delay report, not just the dropdown.** A forwarder whose
permits sit with the road authority and whose survey sits with a marine surveyor had to file both
under "Customs / authority", and `attribution` groups on exactly that
(`milestone.repo.js:194`). So the one screen that exists to tell a port strike from a slow
surveyor reported them as one number. Tom named the split himself, two minutes earlier: "permits
it depends on customs so it doesn't directly depend on us".

### 3.5 [Meeting] "Autre" should read "other taxes"

Timothée at **01:29:29**, twice: "that put it other taxes. Yes. Put it other taxes." Tom:
"So, we changed the word from ultra to other text." `KIND_LABEL.OTHER` was `"Autre"`
(`client/src/features/settings/tax-jurisdictions.tsx:66`) while the VAT tab beside it already read
`"TVA (VAT)"` — so one tab was bilingual and four were not.

### 3.6 [Meeting] Correcting a stage's wording required republishing the chain

Tom at **01:35:55**: "I'll even make it in such — I think I have to make such a way that you can
even edit the names directly like you pick a particular line and you edit it. or you delete a
line or anything. I think we should work with that now."

Fixing "visibility" → "feasibility" meant **Publish new version**, which bumps the version
counter and leaves a v4 differing from v3 by one letter. That is the same dishonest ledger
`activateTemplate` was written to avoid (10708b).

### 3.7 [Found] The payroll engine never read the rates Tom was demonstrating

This is the largest finding and nobody raised it. At **01:20:56**, on the tax screen:

> "if the rate ever changes, let's say C[FC] changes, you just come here and you amend the rate
> and you pick from when it should start applying. So there is no — I mean it's not rigid. It's
> not uh hardcoded and tomorrow something changes and you're not able to uh change it."

It was hardcoded. `src/modules/hr/payroll/payroll.rules.js:13-31` carried its own
`cnps_pension_rate`, `cnps_ceiling`, `cnps_family_rate`, `cfc_employee_rate`,
`cfc_employer_rate`, `fne_rate`, `cac_rate` and `irpp_brackets`, and
`payroll.service.compute:64` layered only `payroll_config` over them. Nothing anywhere read
`tax_code` for a PAYROLL code — `grep` for `annual_brackets` outside the client returns **zero
backend hits**. Amending CNPS on the screen the tenant was shown changed **no payslip**, and the
two registries could disagree indefinitely with nothing to reveal it.

### 3.8 [Found] `tax_code.brackets` was read by the frontend and by nothing else

The corollary of 3.7, and the reason 3.7 was invisible: the IRPP barème the editor writes
(`client/src/features/settings/tax-brackets-editor.tsx`) had no backend reader at all. The
accountant could author a scale, see it saved, see its version history — and it governed nothing.

### 3.9 [Found] The weight on a published chain was invisible outside the editor

The owner spent 01:37:04 → 01:58:19 on weights ("you need to come and uh repartition the weight
so that it's fully 100%"), and the service-type 360's Milestones tab listed seq, code, FR, EN and
offset — not weight, not owner. `ServiceTypeTemplateStage`
(`client/src/lib/operations-api.ts:682`) declared six fields while the repo
(`service_type.repo.js:72-78`) was already sending all of them: the data was in the response and
invisible to TypeScript. So a published chain summing to 97 — which silently shortens every
forecast on that service by 3%, forever — could only be found by opening the editor.

### 3.10 [Found] A JSON round-trip zeroed the top IRPP band

Found while wiring 3.7. `payroll_run.config_snapshot = JSON.stringify(cfg)`
(`payroll.service.js:381`) and JSON has no `Infinity`, so `DEFAULTS.irpp_brackets`'s
`{upTo: Infinity}` serialises to `{upTo: null}`. `progressive()` then computed
`Math.min(base, null)` → `0`, the top band contributed **nothing**, and a 10M annual taxable read
850,000 instead of 2,600,000 — a 67% under-tax, from a snapshot that looks fine. Latent before
this PR (the snapshot was display-only and a recompute re-resolved), and would have become live
the moment a resolved barème was stored.

### 3.11 [Found in CI] A seed's NUMBER decides which database it runs against

Found by the `migrations` job on PR #539, which is the only job that can see it.

`migrator.files` partitions one directory by numeric prefix — `tenantSeeds` is
`/^90/` and `platformSeeds` is `/^91/` — and nothing in a filename says which. The two
seeds here were first numbered 9160/9161, chosen by taking the highest file in
`migrations/seeds/` (9150) and adding ten. 9150 is a PLATFORM seed. So both landed in the
platform range and were applied to the platform database, where none of their tables exist:

```
[praxis-db] platform migration FAILED: Failed applying seeds/9160_seed_milestone_owners.sql
  [platform-seed]: relation "milestone_owner" does not exist
```

Every other gate passed on the broken files — numbering, idempotency, reversibility, schema
drift — because `scripts/ci-local.js` skips provisioning, which needs a live Postgres. Renamed
to **90998** and **90999**, which sort after both prerequisites (9010 tax, 9091 milestone
templates) and inside the tenant range.

`tests/unit/seed-scope.test.js` now pins it, and it is static so it runs in `npm run ci`:
every platform seed schema-qualifies every write as `platform.<table>` — all seventeen, with
no exceptions, because the platform migration runs with no tenant schema on the search path —
and no tenant seed writes to a platform table. The prefix and the qualification have to agree.
Verified against the real bug: with the file renamed back to 9160 the gate fails and names
`milestone_owner, milestone_template_stage`.

---

## 4. Owner decisions

Taken from the review of this register. These are final.

- **D1 — Milestone owners become a tenant registry, seeded richer than the five.** The owner's
  words: "Option 1 but seed in more from values for all tenants." So `milestone_owner` ships 19
  rows, not 5: the original five plus customs, the road and port authorities, shipping line,
  airline, railway, haulier, warehouse keeper, surveyor, insurer, bank, overseas agent, supplier
  and a named "other party". Shipped rows are renameable and deactivatable, never deletable.
- **D2 — The registry is reachable from both places.** The gear beside the owner dropdown in the
  chain editor (where you notice the gap) and a permanent button on the Milestones page.
- **D3 — Every owner carries `is_internal`.** The delay report's ours-or-theirs split reads that
  flag and nothing else, so it keeps working for an owner that did not exist when the report was
  written. Nothing infers it from a name.
- **D4 — Tax mapping: repair, block and show.** Fill every missing side; refuse a new or amended
  code that is not mapped on both sides to postable leaves; show the mapping per row and name
  every remaining gap in a banner at the top of the jurisdiction.
- **D5 — The counterparts are applied as proposed, and treated as settled** (the owner declined a
  sign-off flag). Output VAT → debit 4111; input VAT → credit 4011; employee withholdings → debit
  422 `Personnel, rémunérations dues`; `SIT_NONRES` → debit 4011 / credit 4474; `IS_MIN_*` →
  credit 5211.
- **D6 — The tax codes become the source of the payroll rates.**
  `DEFAULTS < tax_code < payroll_config`. The per-entity override still wins, because a
  negotiated injury class is a deliberate decision and silently overruling it would be the worse
  bug — but where the two disagree, the disagreement is now shown.
- **D7 — Account labels stay French; nothing else does.** `Autres taxes (Other taxes)`, and the
  same `French (English)` shape on every family tab, hint and column.
- **D8 — All four chain-editor items.** Full-width dialog with both names on the row; weight and
  owner on the read-only tab; rename a stage on the live version; weight shown in days as well as
  percent.

---

## 5. What was built

| Finding | Where |
| --- | --- |
| 3.1, 3.5, D4, D5, D7 | `migrations/seeds/90999_tax_code_account_mapping_repair.sql`, `tax_jurisdiction.rules.assertPostingAccounts`, `tax_jurisdiction.repo.unmappedCodes`, `GET /tax-jurisdictions/unmapped`, `client/src/features/settings/tax-jurisdictions.tsx` |
| 3.4, D1, D2, D3 | `migrations/tenant/14400_milestone_owner_registry.sql`, `migrations/seeds/90998_seed_milestone_owners.sql`, `src/modules/master/milestone_owner/`, `client/src/lib/milestone-owners.ts`, `client/src/features/masterdata/milestone-owners-dialog.tsx` |
| 3.2, 3.3, 3.9, D8 | `client/src/features/masterdata/service-type-template-form.tsx`, `service-type-dossier.tsx`, `operations-api.ts` |
| 3.6, D8 | `milestone.service.renameStage`, `PATCH /milestones/templates/stages/:stageId`, inline edit on the Milestones tab |
| 3.7, 3.8, 3.10, D6 | `src/services/accounting/payroll-rates.js`, `payroll.rules.progressive`, `payroll.service.compute` / `saveConfig` / `effectiveRates`, `GET /payroll/config/effective` |

### Gates added

| Gate | What it pins |
| --- | --- |
| `tests/unit/tax-code-account-mapping.test.js` | Every seeded code maps both sides to a postable leaf, the 90999 repair cannot be dropped, and the API rule refuses the thirteenth. Static — no Postgres needed. |
| `tests/unit/payroll-rates-from-tax-codes.test.js` | Every key the resolver emits is a key the engine has; the seeded barème and the engine's default produce identical tax; the JSON round-trip of 3.10 cannot return. |
| `tests/unit/milestone-owner-registry.test.js` | All three CHECKs are dropped together, the registry seeds both languages and exactly one internal row, and `renameStage` refuses anything that would move a schedule. |
| `tests/unit/milestone-seed.test.js` | Now derives the valid owner set **from seed 90998** instead of a hardcoded copy, so it cannot pass while a stage points at an owner no tenant has. |
| `tests/unit/seed-scope.test.js` | A seed's numeric prefix matches the database it writes to (3.11). Catches, statically, the one class of seed bug that otherwise only a live-Postgres CI job can see. |

### Migration numbers used

| Scope | Number | File |
| --- | --- | --- |
| tenant | 14400 | `14400_milestone_owner_registry.sql` |
| seeds | 90998 | `90998_seed_milestone_owners.sql` |
| seeds | 90999 | `90999_tax_code_account_mapping_repair.sql` |

The two data files are **seeds, not tenant migrations**, and that is load-bearing:
`provisioning.migrateTenantDb` applies every tenant migration and only then every seed, so a
repair of 9010's rows written as a migration would run *before* 9010 inserted them on a fresh
tenant and silently do nothing.
