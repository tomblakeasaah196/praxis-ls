# Sales & CRM, lean revamp: engineering guide and build plan

**Status:** plan, agreed with the owner. The decisions in §2 are final: build them, do not re-ask them.
**Date:** 17/11/2026 · **Repo read at:** `a313976` (main)
**No application code in this document.**
**Scope:** every tab of Sales & CRM, the website and portal paths into it, Quotations, Company Profile,
Success Stories, and the pieces of Settings, Dashboard and Operations they touch.

Sales & CRM goes from **eleven tabs to five**, from **five records per job to two**, and from
**about 25 statuses to 6 stages**. Seven PRs, in four waves (§7).

---

## 0. Why this exists, and how we will know it worked

The first tenant has never used Sales & CRM. His word for it is "cumbersome". A solid foundation is
wasted if nobody opens it, so every line of this plan answers to four jobs a freight forwarder's
sales desk actually does, and anything that serves none of them is cut:

1. **Answer every enquiry**, from the website or the phone, the same day.
2. **Chase every lead** until it is won or dead. Nothing goes quiet because nobody was reminded.
3. **Quote fast and well**: a priced quotation from a request in minutes, as a full proposal when the
   prospect needs convincing, as a one-page commercial extract when they only want the price.
4. **Turn a yes into work**: an accepted quotation opens the operations file with nothing retyped.

### Success measures (checked with SMART 30 days after go-live)

| Measure | Target | How it is read |
|---|---|---|
| Open leads with a dated next step | 100% (enforced by the service) | `lead` OPEN with no open `next_step_task_id` = 0 |
| Manual lead capture | 2 required fields, under 15 seconds | capture dialog |
| Website request to sent quotation | median under 1 working day | `quote_request.created_at` to `quotation.sent_at` |
| Accepted quotation to operations file | 100% automatic | requests WON with `dossier_id` NULL = 0 |
| People using Sales weekly | the MD and at least one staff member | audit ledger, module MOD-20 |

---

## 1. Audit: what exists today

### 1.1 The tabs

| Tab today | What it does | Verdict |
|---|---|---|
| Leads & Intake | Lead register (split pane) + Lead 360 + an "Inbound intake" tab | **Becomes Leads**, the one 360 |
| Contact Enquiries | Website contact desk: classify, reply, raise a lead or a partnership | **Becomes General Enquiries** |
| Quote Requests | Intake register + its own Intake 360 | **Folded into Leads** as the request inside a company |
| Opportunities | Pipeline board and list, configurable stages, probability, win opens a file | **Folded into the request** (stage + value) |
| Proposals | Narrative + its own price lines, AI draft, share link, portal e-signature | **Merged into Quotations** |
| Quotations | VAT, débours, costing import, target margin, portal e-signature, invoice | **The one priced document** |
| Company Profile | A fact sheet the AI grounds itself in | **Rebuilt** on the platform model |
| Meetings | Discovery capture (three sections, dictation) | **Inside Lead 360**, scheduled on the calendar |
| Campaigns | Templates, approvals, hand-entered figures, newsletter list | **Deleted** |
| Partnerships | Partner and vendor applications, approval opens a draft supplier | **Deleted** |
| Success Stories | Builder, consent, publish to the website Portfolio | **Kept** |

Also: **Settings › Pipeline Stages** is deleted (stages become fixed).

### 1.2 One job, five records

A website quote today becomes a `lead` (NEW, CONTACTED, QUALIFIED, CONVERTED, LOST) **and** a
`quote_request` (six statuses, `0683_sales_crm_f6_lead_intake.sql:98`), is converted into an
`opportunity` (OPEN, WON, LOST plus configurable stages), gets a `proposal` (DRAFT, IN_REVIEW, SENT,
ACCEPTED, REJECTED) and then a `quotation` (six statuses, `0345_commercial.sql:21`). Each has its own
screen. The code says so itself, in `sales-360.tsx`'s header: the split "left a salesperson with
three registers and no one place that answers *what is going on with this company*".

### 1.3 Gaps

1. **Nothing says what to do next.** `lead` has no next action or follow-up date
   (`0350_sales_crm.sql:7`), and nothing reminds anyone. My Workspace already has `task` and
   `calendar_event` with `entity_type`/`entity_id`, due dates and an armed-reminder sweep
   (`13810_workspace_tasks_events.sql:101,225`). Sales never writes one.
2. **The Lead 360 is read-only.** Seven tabs (`sales-360.tsx:569`) and no action inside any of them.
   To book a meeting or draft a proposal you leave, open another tab and pick the lead again.
3. **The "Inbound intake" tab is a signpost** to two other tabs (`leads.tsx:285`).
4. **No duplicate check.** Every website quote calls `lead.create` (`public_intake.service.js:177`),
   so the same company sending three requests becomes three leads.
5. **Meetings never reach the calendar.** `meeting` has no link to `calendar_event`; no invite, no
   reminder. The discovery capture itself is good.
6. **Two price documents for one offer.** `proposal_line` has no tax, no débours and no costing
   (`0350_sales_crm.sql:76`); accepting a proposal can then create a quotation
   (`proposal.service.js:122`), which has all three. A client can hold two documents with two prices.
7. **A yes does not become work.** Winning an opportunity opens the operations file
   (`opportunity.service.js:120`); accepting a quotation only drafts an invoice
   (`quotation.service.js:160`). Neither calls the other.
8. **Company Profile is not a document.** Three fields are raw JSON in a text box with database
   names for labels (`company-profile.tsx:156`). Nothing prints, shares or tracks it.
9. **Website wiring.** Quote wizard → lead + request: works. Contact form → enquiries, already with a
   Partnership type: works. `/public/intake/partnerships` has **no form** on the site
   (`public-web/src/lib/intake-api.ts`). The footer newsletter writes into Campaigns
   (`marketing_campaign.service.js:179`). The Portfolio page reads Success Stories.
10. **Lists load whole registers** and filter in the browser (`leads.tsx:86`).
11. **Mail checks the wrong permission for leads.** `mail-context.service.js:227` and
    `convert.service.js:45` gate a lead under **MOD-26**, which is the Project Portfolio Builder
    (Success Stories), not MOD-20 (leads). Someone with lead access but no portfolio access sees no
    lead name on a bound mail thread and cannot turn a mail into a lead; someone with only portfolio
    access can.

### 1.4 Keep

The enquiry desk (reply from the screen, raise a lead), the quote wizard (verified places,
Incoterms, documents), the quotation engine (VAT, débours, costing import, target margin, portal
e-signature through `portal_signing.js`, invoice conversion), tracked share links, the discovery
capture with dictation, server-side money gating (`kpis.money_visible`), Success Stories with its
three-state consent.

### 1.5 What the two donor projects teach (ideas only, no code is copied)

**MyCity proposals.** Five steps (Brief, Questions, Draft, Edit, Send); a fixed kit of page
layouts so nobody can break the look; **one HTML render** is the preview, the public page and the
PDF; every open recorded, the first notifies the owner; revise makes v2 and sending it withdraws v1.
Its weak spots we do not repeat: a template exists only as "save from a finished one" with no screen
to edit it; no pricing engine; no client acceptance on the link.

**Platform Company Profile.** Fixed sections; **facts stored once in `structure`, words per
language** keyed by id, so English and French cannot disagree; show/hide switches applied when data
is read, so no renderer can leak a hidden item; draft then publish, a published version is never
edited, field diff and audit; one data contract feeding the PDF and per-recipient share links with
expiry, revoke and open tracking. Its weak spots we do not repeat: no link to proposals or leads, no
tenant branding, image paths typed by hand.

---

## 2. Owner decisions (final)

Asked 17/11/2026. Q11 was added at the owner's request when Q2's first answer was challenged.

| # | Question | Decision |
|---|---|---|
| D1 | Who uses it, on what | The MD and 1 to 3 staff, **mostly at a desk**. Desktop-first; the phone shell still works. |
| D2 | One row in Lead 360 | **One company.** Searching "Total Energies" returns one row, never thirty. |
| D3 | Opportunities | **Folded in.** No separate opportunity record. Fixed stages: New, Contacted, Meeting, Quoted, Won, Lost. The board is a toggle on the Leads list. |
| D4 | Follow-ups | **Every open lead has a next step**, with a date. It shows in My Workspace Today with a reminder, reusing the tasks engine. Overdue is red in the list. |
| D5 | Manual capture | **Company + one contact way** (phone or email). A collapsed **More Details** line opens the full form. Duplicate check on company, email and phone. |
| D6 | The merged document | Called **Quotation**. One switch prints it as **Full Proposal** or **Commercial Extract**. Built on today's quotation engine. French: Devis / Proposition commerciale. |
| D7 | Acceptance | **On the shared link**, with name and signature, no portal account needed (portal clients can also accept there). Acceptance marks the request **Won**, makes a prospect a **client**, and **opens the operations file**. Staff can record it by hand. |
| D8 | Template builder | **Section library**, and **the leanest possible**: fixed sections, fixed order, on/off and default text per language. Nothing else. |
| D9 | Company Profile | **The platform model, no slide deck.** About Us of every Full Proposal, a standalone PDF, tracked share links logged on the lead. Figures like fleet and warehouse space come from the tenant's own data. |
| D10 | Removals | **Delete** Campaigns and Partnerships & Vendors (code and tables). **Keep Success Stories** as its own page. |
| D11 | Inside one company row | Each request is **one record that is both the quote request and the deal**: its own stage, value, quotations and follow-ups. **Clients keep their row** after conversion, so later website and portal requests land on it. |

What follows from D10, decided here so no session re-asks: the website footer **newsletter form is
removed** with Campaigns (its table goes with it), and `/public/intake/partnerships` is removed
(no form uses it). Partnership offers keep arriving through the contact form's Partnership type.

---

## 3. Target experience

### 3.1 The area

```
Sales & CRM:   Leads · Quotations · General Enquiries · Success Stories · Company Profile
```

Old URLs redirect, so links in emails, notifications and the AI keep working (§5.6).

### 3.2 Leads (the Lead 360)

**The list** (desktop: `SplitPane`, list left, record right, as today; phone: the record opens in a
sheet).

- One row per company: avatar and name, a **Prospect** or **Client** pill, the **next step date**
  (red when overdue, amber when today), and open value (hidden without finance visibility).
- Chips: **My Next Steps** (default: open leads I own, soonest next step first), **All Open**,
  **Prospects**, **Clients**, **Archived**.
- Three tiles that are also filters: **Due Today**, **Overdue**, **Open Value**. No other tiles.
- Search: company, contact, email, phone, and a request's reference (`SQ-2026-0042` finds its company).
- A **List | Board** toggle. The board shows **requests**, not companies, in columns New, Contacted,
  Meeting, Quoted, with Won and Lost collapsed. Dragging a card moves its stage. Desktop only.
- Server-side paging and filtering. The list stops loading the whole register (gap 10).
- One button: **Capture Lead**.

**Capture Lead** (dialog).

- Shown: **Company or Person** (required), **Phone or Email** (one required), **What Do They Need?**
  (a service type, optional: when set, the first request is created with it), **Next Step** and its
  date (required, defaults to "Call back", tomorrow at 09:00).
- A collapsed **More Details** line opens the rest: contact person, the second contact way, country,
  address, NIU, RCCM, source, owner (defaults to me), corporate entity, client type, payment terms.
- **Duplicate check as you type** (company, email, phone): "Already here: TotalEnergies Marketing
  Cameroun · Client. **Open It**". Opening it closes the dialog on that company; nothing is created.

**The record.**

- **Header:** name, Prospect or Client pill, owner, the contact line with click-to-call, mailto and
  WhatsApp links, and the **Next Step card**: the action, its date, and a **Done** button.
- **Buttons:** **New Request**, **Log Activity**, **Schedule Meeting**, **New Quotation**. Overflow:
  Edit, **Make Client** (prospects only), **Archive**.
- **Four tabs** (counts on each):
  - **Activity**: one timeline. Activities, meetings, mail threads bound to the lead (the mail
    binding already resolves `lead`), quotations sent, viewed, accepted, declined, stage moves,
    profile shares. A one-line note box at the top.
  - **Requests**: one card per request with its stage bar, service, route and value.
  - **Quotations**: number, request, total, status, viewed, valid until.
  - **Details**: the full company form and KYC, contacts, documents.

**The loop that makes it used.** **Done** on the next step opens one small dialog: *What happened?*
(Call, Email, WhatsApp, Visit, Note, plus one line) and *What's next?* (action and date). Saving logs
the activity and sets the new next step in one write. The only way to have no next step is
**Archive** (with a reason) or every request being Won or Lost and the lead being a client. Completing
the task from My Workspace opens the same dialog through `/sales/leads/<id>?done=<task_id>`.

**A request** (a sheet over the 360, deep-linkable as `/sales/leads/<lead>?request=<id>`).

- A **stage bar**: New → Contacted → Meeting → Quoted → Won / Lost. Clicking a stage moves it.
  **Lost** asks a reason (Price, Timing, Competitor, No Response, Other, plus a line).
  **Won** happens through an accepted quotation, or **Mark Won** with a confirm that names what it
  does ("Opens operations file for TotalEnergies").
- Fields: title (for a request typed by hand), service type, Incoterm, route (verified places),
  cargo, weight, documents (upload engine), estimated value and currency, channel, reference.
- Actions: **New Quotation** (prefilled), **Open Costing** when one exists, **Open File** once Won.
- Website and portal requests arrive at New with a **Website** or **Portal** pill and notify the
  owner.
- Automatic moves, never backwards: scheduling a meeting on a request moves it to Meeting; sending a
  quotation moves it to Quoted.

**Meetings.** **Schedule Meeting** asks subject, date and time (`DateTimeField`), duration, location,
attendees (staff), and optionally the request. It writes a `meeting` and a `calendar_event` with a
reminder, so it appears in My Workspace › Calendar. Opening the meeting from Activity shows today's
discovery capture (three sections, per-section dictation) unchanged. The latest discovery set feeds
the quotation's **Your Needs** and **Our Solution** drafts.

**Who owns a website lead.** The existing lead's owner; otherwise the **default sales owner**, one
setting in Settings & Admin (for SMART, the MD). The next step "Answer website request", due within
four working hours, is created on arrival.

### 3.3 General Enquiries

Today's desk, renamed, with three changes:

- **Raise Lead** runs the same duplicate check and attaches to an existing company or creates one,
  with a next step for the person who raised it.
- The **to partnership** route is removed. **Partnership** stays as an enquiry type.
- Manual **Log Enquiry** and **reply from the screen** stay as they are.

### 3.4 Quotations

**The list.** Number, company, request, total (money-gated), status, viewed, valid until. Chips:
All, Draft, Sent, Accepted, Declined, Expired. One button **New Quotation** (pick a company and
request, or start from a costing as today). A **Templates** button in the page header.

**The editor** (one page, `/sales/quotations/<id>`).

- **Top bar:** the **Full Proposal | Commercial Extract** switch, the language (EN, FR, Both), the
  template, **Send**.
- **Left:** the price lines (today's engine: dictionary items, débours, tax codes, target-margin
  warning, import from costing), then the sections.
- **Right:** a live preview. **One HTML render is the preview, the public page and the PDF**, so they
  cannot disagree.
- **Sections** (Full Proposal), fixed library, fixed order, each with on/off:

  | Section | Content |
  |---|---|
  | Cover | Automatic: tenant branding, client, title, reference, date |
  | About Us | The **published** Company Profile, read-only here, pinned at send |
  | Your Needs | Prefilled from the request and the latest discovery; editable |
  | Our Solution | Template text; editable; **Draft With AI** from the discovery and profile |
  | Scope of Services | Template text; editable |
  | Pricing | The lines. **Always on** |
  | Terms | Validity, payment terms, free days, plus template text |
  | Case Stories | Up to three published Success Stories (consent respected) |
  | Next Steps | Automatic: how to accept, the contact |

- The **Commercial Extract** prints the letterhead cover, Pricing, Terms and Next Steps. Same record,
  same lines, same totals. The switch changes which sections print, never a number.

**Send** (dialog): To (the lead's contact by default), Cc, Subject, Message, output (from the switch),
PDF attached. It sends through the mail engine, opens a share link valid until `valid_until`, sets
the quotation SENT, moves the request to Quoted, and proposes the next step "Follow up quotation" in
three working days.

**The link** (`/q/<token>`, public-web). The chosen output, a language switch, **Download PDF**,
**Accept** (name, role, then the signature programme's emailed code and stamp or drawn mark, with the
recipient email as the counterparty) and **Decline** (reason list). Portal clients also see it under
Quotations. Every open is recorded (time, coarse browser, hashed visitor); the first notifies the
owner and lands on the lead's Activity.

**Revise.** On a sent quotation, **Revise** copies it into version 2 as a draft; sending v2 revokes
v1's link (`supersedes_id`).

**Statuses** (labels in the UI): Draft, Sent, Accepted, Declined (`REJECTED`), Expired, Invoiced
(`CONVERTED`). The proposal's IN_REVIEW step is not carried over. A margin under target stays a
warning, as today.

**Acceptance** (link, portal, or staff **Record Acceptance**) does, in this order: quotation
ACCEPTED → request **Won** → a prospect becomes a **DRAFT client** from its lead data
(`client_master` starts DRAFT already) and the lead keeps its row as a Client → the **operations
file opens** from the request (client, service type, route, entity) → the owner is notified.
Converting to an invoice stays the separate, optional step it is today.

### 3.5 Templates (the leanest builder)

- Reached from the **Templates** button on Quotations. Not a tab.
- One screen: templates on the left (name, service types, a star for the default). On the right, the
  **fixed section list**: a switch per section (is it on by default in a Full Proposal), and for
  **Our Solution**, **Scope of Services** and **Terms**, one text box with **EN | FR** tabs.
  **Preview** renders it with sample data.
- **Nothing else.** No reordering, no custom sections, no merge fields, no images, no fonts, no
  colours: the look is the tenant's branding.
- **New Quotation** picks the template whose service types include the request's, else the default.
  The text is **copied** into the quotation when it is created, so editing a template never changes a
  quotation already made.
- Every tenant starts with one template, **Standard**, with plain EN and FR text.

### 3.6 Company Profile

- **One editor screen.** Sections on the left with an on/off switch and a completeness dot; fields on
  the right with **EN and FR side by side**; autosave on blur. Header: status (Draft or Published
  v3), **Preview**, **Download PDF**, **Share**, **Publish**.
- **Sections** (fixed):

  | Section | Content |
  |---|---|
  | Cover | Tagline, cover image |
  | Who We Are | Positioning, history, mission |
  | Services | From published Service Types, each with a switch and one sentence |
  | Capacity & Network | **Derived** from the tenant's data: fleet size and mix, warehouse space, offices and gateways, regions. Each figure has a switch |
  | Certifications & Memberships | A list with a **Held** switch per item, optionally backed by a vault document |
  | Case Stories | Picked from published Success Stories |
  | Clients | A logo library (image pipeline, `brand` profile) with an **On Profile** tick, retired not deleted |
  | Why Choose Us | Up to six promises |
  | Contact | From the corporate entity and site settings |

- **Facts once, words per language**: `structure` holds ids, order, switches and links; `text_en` and
  `text_fr` hold the words keyed by those ids. Hidden items are removed when data is read, before any
  renderer.
- **Versions:** one draft at a time; **Publish** (permission) supersedes the previous version; a
  published version is never edited; history with a field diff; audit on every step. No review step.
- **Outputs:**
  1. The **About Us** pages of every Full Proposal (the version published at send is pinned).
  2. A standalone branded **PDF**.
  3. **Share links**: pick a lead or type a recipient, expiry, revoke, opens tracked, the first open
     notifies, the share and its opens land on the lead's Activity. Public page
     `/profile/<token>` on public-web.
- The AI reads the **published** profile only. The no-cost-or-margin rule stands.
- No slide deck (D9).

### 3.7 Success Stories

Unchanged in behaviour and keeps its tab. It becomes the **one source** of case stories for Company
Profile and the Full Proposal, and keeps feeding the website Portfolio page.

### 3.8 Website and portal

| Path | After |
|---|---|
| Quote wizard | Same for the visitor. Server: **find or create** the company row (email, then phone, then folded company name), add a request at New, attach documents, set the next step, notify the owner |
| Contact form | Unchanged → General Enquiries |
| Footer newsletter | **Removed** (form, endpoint, table) |
| `/public/intake/partnerships` | **Removed** |
| Portfolio | Unchanged |
| Public proposal page | Becomes the public **quotation** page `/q/<token>`; existing proposal tokens resolve to their migrated quotation |
| Portal › Proposals | **Removed**; Portal › Quotations lists every quotation |
| Portal › Requests | A request lands on the client's company row (created if the client has none, as a Client) |

### 3.9 Phone and desktop

Desktop-first (D1). The phone keeps working through the patterns already in place: the record in a
sheet, the capture dialog, the Done dialog. The board view and the quotation editor's side-by-side
preview are desktop only; on a phone the preview is a **Preview** button.

---

## 4. Data model

Table names stay where renaming would only churn references: the UI says **Request**, the table is
still `quote_request`. Every destructive statement carries a `-- DESTRUCTIVE: <reason>` marker
(`scripts/db/check-destructive-migrations.js`) and every migration has a `-- DOWN`.

### 4.1 `lead`: the company row

- `status` becomes `OPEN | ARCHIVED`. Backfill: NEW, CONTACTED, QUALIFIED, CONVERTED → OPEN;
  LOST → ARCHIVED. Add `archived_reason text`.
- **Prospect or Client** is derived: `client_id IS NULL`.
- **One row per client**: partial unique index on `client_id`. Backfill merges any duplicates into
  the oldest (requests, meetings, quotations and activities move; the other is archived).
- `next_step_task_id uuid REFERENCES task(task_id)`: the current next step. The list reads its
  `due_at` through a join.
- Duplicate keys for the check: folded email, phone digits only, folded company name (the fold
  function from `14382_search_fold_trigram.sql`), indexed.
- `convert` stops requiring QUALIFIED; it becomes **Make Client** and is also called by acceptance.

### 4.2 `quote_request`: the request, which is also the deal

- Add: `stage text NOT NULL DEFAULT 'NEW'` with CHECK (NEW, CONTACTED, MEETING, QUOTED, WON, LOST),
  `title text`, `estimated_value numeric(18,2)`, `currency char(3) REFERENCES currency(code)`,
  `lost_reason_code text`, `lost_reason text`, `settled_at timestamptz`,
  `dossier_id uuid REFERENCES dossier(dossier_id)`.
- `lead_id` becomes NOT NULL after backfill (every request belongs to a company row).
  `incoterm` becomes nullable; the validator still requires it for WEBSITE and PORTAL channels.
- Backfill `stage` from `status`: RECEIVED → NEW; UNDER_REVIEW, CLARIFICATION_REQUIRED → CONTACTED;
  QUOTED → QUOTED; CLOSED_NO_ACTION → LOST ("No response"); CONVERTED_TO_OPPORTUNITY → from its
  opportunity (WON → WON, LOST → LOST, OPEN → QUOTED if it has a quotation, else CONTACTED), also
  copying value, currency, owner, `dossier_id`, `settled_at`.
- An opportunity with no request becomes a request (channel MANUAL, `title` = its name, its lead or
  the client's row).
- `quotation.quote_request_id` (exists) becomes the only link; backfilled from
  `quotation.opportunity_id`.
- `status`, `converted_opportunity_id` and the `quote_request_sync_converted` trigger stay until
  PR 7 and are then dropped.

### 4.3 `lead_activity` (new)

`lead_activity_id`, `lead_id`, `quote_request_id` (nullable), `kind` CHECK (CALL, EMAIL, WHATSAPP,
VISIT, NOTE), `body` (1 to 2,000 characters), `occurred_at`, `author_user_id`, `created_at`.
Mail threads, quotation events and stage moves are **not copied** into it: the 360 timeline reads
them where they live.

### 4.4 Next steps

A next step is an ordinary workspace `task` (`entity_type = 'lead'`, `entity_id`, `assigned_to` the
owner, `due_at`, a reminder) pointed at by `lead.next_step_task_id`. The lead service is the only
writer of that pointer and refuses an OPEN lead without one (§3.2 says when none is allowed).

### 4.5 `meeting`

Add `calendar_event_id uuid REFERENCES calendar_event(calendar_event_id)` and
`quote_request_id uuid REFERENCES quote_request(quote_request_id)`. Discovery tables unchanged.

### 4.6 `quotation` absorbs `proposal`

- Add: `lead_id uuid REFERENCES lead(lead_id)` with CHECK (`client_id` or `lead_id` set), `title`,
  `language` (EN, FR, BILINGUAL), `template_id`, `default_output` (FULL, EXTRACT; default FULL),
  `profile_version_id`, `share_token_hash`, `share_expires_at`, `share_revoked_at`, `viewed_at`,
  `downloaded_at`, `version integer NOT NULL DEFAULT 1`, `supersedes_id`, `sent_at`, `sent_to`,
  `sent_cc`, `sent_subject`.
- `quotation_section` (new): `quotation_id`, `section_key` CHECK (cover, about_us, needs, solution,
  scope, pricing, terms, case_stories, next_steps), `enabled`, `body_en`, `body_fr`,
  `story_ids uuid[]`; unique (`quotation_id`, `section_key`).
- `quotation_template` (new): `template_id`, `name`, `service_type_ids uuid[]`, `is_default` (one
  default, partial unique index), `sections jsonb` (key → enabled, body_en, body_fr), `active`.
  Seeded with **Standard**.
- `quotation_view` (new): `quotation_id`, `opened_at`, `agent_label`, `visitor_hash`.
- Migrate proposals: each becomes a quotation (IN_REVIEW → DRAFT; the other statuses map by name,
  REJECTED stays REJECTED), its lines become `quotation_line` (no tax code, not débours), its
  narratives become sections (executive_summary → needs, scope → scope, terms → terms, per
  language). A proposal already converted (`converted_quote_id`) only adds its sections to that
  quotation. Share tokens carry over.

### 4.7 Company Profile

- New: `company_profile_version` (number, `status` DRAFT, PUBLISHED, SUPERSEDED, `change_note`,
  published by and at; one DRAFT at a time), `company_profile_section` (`version_id`, `section_key`,
  `structure jsonb`, `text_en jsonb`, `text_fr jsonb`), `company_profile_logo`,
  `company_profile_share` (token hash, recipient, `lead_id` nullable, pinned `version_id` or NULL to
  follow the published one, expiry, revoked), `company_profile_share_open`.
- The singleton `company_profile` keeps only the **derived** columns (fleet, warehouse, clients,
  lanes, computed_at). The declared columns migrate into version 1's sections and are dropped in PR 7.
- `company_profile_project` rows become **draft Success Stories** (consent NOT_ASKED) and the table is
  dropped in PR 7.

### 4.8 Deleted

PR 1: `marketing_campaign` and its 0685 children, `newsletter_subscriber`, the 0452 campaign
template tables, `partnership_request` with its 0699 and 10701 additions,
`contact_enquiry.partnership_request_id`, and the `campaign.send` mail send point row.
PR 7: `opportunity`, `pipeline_stage`, `proposal`, `proposal_line`, `proposal_narrative`,
`quotation.opportunity_id`, `quote_request.status`, `converted_opportunity_id` and its trigger, the
declared `company_profile` columns, `company_profile_project`.

---

## 5. Backend and cross-cutting

### 5.1 Modules after the revamp

| Module | After |
|---|---|
| `sales/lead` | The company row, the 360 (`sales-360.service.js` moves here), activities, next steps, duplicate check, Make Client, Archive |
| `sales/quote_request` | The request: stage machine, Lost reasons, Mark Won, find-or-create for intake |
| `sales/meeting` | Kept; scheduling writes the calendar event |
| `sales/inbound_intake` | General Enquiries; triage uses the lead duplicate check |
| `sales/public_intake` | Quote and contact only |
| `sales/company_profile` | Versions, sections, PDF, share links, derived refresh |
| `sales/success_story`, `sales/portfolio_public` | Kept |
| `commercial/quotation` | Absorbs proposal: sections, templates, output, send, share, view log, revise, AI draft (the proposal generator moves here) |
| `commercial/quotation_public` | The public `/q/<token>` read, download, accept, decline (from `proposal_public`) |
| Deleted | `sales/marketing_campaign`, `sales/partnership_request`, `sales/opportunity`, `sales/proposal`, `sales/proposal_public`, Settings › Pipeline Stages |

Module keys: MOD-20 (lead, request), MOD-21 (meeting), MOD-25 (enquiries; partnerships leave it),
MOD-26 (success stories), MOD-27 (quotation). MOD-22 (campaigns), MOD-23 (proposal) and MOD-24
(opportunity) are retired from the module catalogue, permissions and seeds.

### 5.2 One write path for a yes

`quotation.accept` commits the acceptance and emits `quotation.accepted`. A new outbox handler
`quotation.accepted:win-request` does the follow-on work, idempotently, exactly as
`opportunity-won-open-dossier.js` does today (which it replaces): request WON, Make Client when the
lead is a prospect, open the operations file through `operations_file.service`, link `dossier_id`,
notify. **Mark Won** by hand calls the same service function.

### 5.3 Dashboards and Control Tower

`dashboard/kpi_catalog/sales_procurement.js` (`pipeline_won`, open pipeline) and the Control Tower
drilldowns read `quote_request.stage` and `estimated_value`, and drill to
`/sales/leads?view=board`.

### 5.4 AI

Every manifest changes with its module (CLAUDE.md, "Wire every module to the AI"):

- `lead.ai.js`: read the 360, capture (with the duplicate check), log activity, set the next step.
- `quote_request.ai.js`: create a request, move a stage, mark lost.
- `quotation.ai.js`: draft sections from discovery, send, record acceptance.
- `company_profile.ai.js`: read the published profile.
- The campaign, partnership, opportunity and proposal manifests are deleted, their keys leave
  `src/services/ai/write-contract-baseline.json`, and the alias map in `orchestrator.service.js` and
  `knowledge/entity-cards.js` follow.

Every write follows the write contract.

### 5.5 Search

`lead.search.js` (company rows, also matched by a request reference), `quote_request.search.js`
(opens the lead with `?request=`), `quotation.search.js`. Delete `opportunity.search.js` and
`proposal.search.js`. Synonyms in `packages/shared/schemas/search.js`: devis, cotation,
proposition, offre → Quotations; prospect, piste → Leads; demande → requests.

### 5.6 Routes and redirects (`client/src/app/app.tsx`, `screen-registry.json`)

| Old | New |
|---|---|
| `/sales/quote-requests`, `/sales/meetings` | `/sales/leads` |
| `/sales/quote-requests/:id` | resolves the request and opens `/sales/leads/<lead>?request=<id>` |
| `/sales/opportunities` | `/sales/leads?view=board` |
| `/sales/proposals`, `/sales/proposals/:id` | `/sales/quotations` (the migrated quotation) |
| `/sales/campaigns`, `/sales/partnerships`, `/sales/inbound-intake` | `/sales/leads` |
| `/sales/enquiries` | unchanged path, label **General Enquiries** |
| `/settings/pipeline-stages` | removed, redirect to `/sales/leads?view=board` |

`packages/shared/rules/entity-route.js`: `opportunity` and `proposal` refs resolve to their migrated
request and quotation, so old notifications still open something.

### 5.7 Documents

One quotation template in `src/services/documents/templates` renders Full or Extract from the same
data, day-first dates, no em dashes, EN, FR or both. The proposal templates are deleted. The Company
Profile PDF is a new template on the same renderer, branded through the branding service.

---

## 6. Rules every PR keeps

From `CLAUDE.md`, the ones this work trips first:

- **No native dialogs.** Every destructive or irreversible action (Archive, Mark Won, Lost, Revise,
  Revoke, Publish) uses `useConfirm()`, whose title names the outcome and whose button names the action.
- **`DateField` / `DateTimeField` only.** Dates are shown with `lib/format.ts`.
- **Uploads through the engine**: request documents (`document`), logos (`brand`), the cover image
  (`photo`).
- **Register every route, tab and record type** for ⌘K (`npm run check:search` from the root).
- **No supporting text on the page**; behind an ⓘ (`check:prose`). Chrome in Title Case, French in
  sentence case, no em dashes anywhere a tenant reads (`check:dashes`).
- **Renaming an English label moves its dictionary key** (`check-prose.mjs --fix-titles`).
- **Validation in `packages/shared`**, used by both sides (`check:schemas`).
- **Generated docs are regenerated, never edited**: `node scripts/generate-api-docs.js`.
- **`npm run ci` before every push**, not a subset.

---

## 7. Build plan: seven PRs, four waves

**Waves.**

- Wave 1: PR 1, then PR 2 and PR 5 in parallel.
- Wave 2: PR 3 and PR 4 in parallel.
- Wave 3: PR 6.
- Wave 4: PR 7.

**Merge order:** PR 1 → PR 2 → PR 3 and PR 4 in either order → PR 6 → PR 7.
PR 5 merges any time before PR 6.

**Where parallel PRs touch the same files:**

- PR 1 and PR 2 both edit `public_intake.service.js` and `inbound_intake.service.js`, which is why
  PR 1 merges first.
- PR 3 and PR 4 meet only at `client/src/app/layout/areas.ts` and `screen-registry.json`, a trivial
  rebase.

Each PR builds and passes `npm run ci` on its own, uses only its migration numbers, and leaves the
product working.

| PR | Title (Conventional Commits) | Size | Depends on | Migrations | Build on |
|---|---|---|---|---|---|
| 1 | `refactor(sales): remove Campaigns and Partnerships & Vendors` | M | none | 14500 to 14509 | standard model, medium effort |
| 2 | `feat(sales): one company row, the request carries the deal` | L | PR 1 | 14510 to 14529 | most capable model, high effort |
| 3 | `feat(sales): the Lead 360 screens, next steps and capture` | L | PR 2 | 14530 to 14539 | most capable model, high effort |
| 4 | `feat(quotations): one document, Full Proposal or Commercial Extract` | L | PR 2 | 14540 to 14559 | most capable model, high effort |
| 5 | `feat(sales): Company Profile, versioned, shareable, bilingual` | L | none | 14560 to 14579 | most capable model, high effort |
| 6 | `feat(quotations): editor, templates, public link and portal` | L | PR 3, 4, 5 | 14580 to 14589 | most capable model, high effort |
| 7 | `chore(sales): drop the retired tables and routes` | S | PR 6 | 14590 to 14599 | standard model, medium effort |

### PR 1 · Remove Campaigns and Partnerships & Vendors

- Delete `src/modules/sales/marketing_campaign/`, `src/modules/sales/partnership_request/`,
  `client/src/features/sales/{campaigns,campaign-forms,partnerships,partnership-forms}.tsx`, their
  tests (`campaign-lifecycle`, `campaign-send`, `partnership-f10`, the matching parts of
  `sales.test.js`), and the Inbound intake signpost tab in `leads.tsx`.
- `public_intake`: remove the `/partnerships` and `/newsletter` routes, validators and service
  functions. `inbound_intake`: remove triage to partnership.
- public-web: remove `newsletter-form.tsx`, its footer slot, its strings, and regenerate the label keys.
- Every reference in the file list from `grep -rl "marketing_campaign\|newsletter_subscriber\|partnership_request"`:
  - `areas.ts`, `hub.tsx`, `screen-registry.json`
  - `screen-specs.ts`, `audit-humanize.ts`, `entity-route.js`
  - `notifications/categories.js`, `document_vault.types.js` (keep the PARTNERSHIP_PROFILE label
    read-only so vaulted files still render)
  - `orchestrator.service.js`, `entity-cards.js`, `seed-sandbox.sql`
  - the idempotency and reversibility baselines
- Migration 14500: the drops in §4.8 (PR 1 list), with DESTRUCTIVE markers.
- Retire MOD-22 from the catalogue and permissions.
- Regenerate the API and error docs.

### PR 2 · One company row, the request carries the deal (backend)

- Migrations for §4.1 to §4.5 with their backfills.
- `lead` service:
  - the duplicate check endpoint
  - capture with a required next step
  - activities
  - the **Done** write (log and next step in one transaction)
  - Make Client, Archive
  - server-paged list with the chips of §3.2
  - the 360 API with the four tabs' data and the merged timeline
- `quote_request` service: the stage machine, Lost reasons, Mark Won (calls the shared win function),
  automatic stage moves, find-or-create used by `public_intake.submitQuote` and the portal.
- The win function and the `quotation.accepted:win-request` handler replace
  `opportunity-won-open-dossier`.
- Meeting scheduling writes `calendar_event`.
- Default sales owner setting.
- Gap 11: the mail binding gates leads under MOD-20 (`mail-context.service.js:227`,
  `convert.service.js:45`), with a test, because the 360 timeline reads those threads.
- KPIs and drilldowns (§5.3), AI (§5.4), search (§5.5).
- The `opportunity` module keeps answering reads until PR 3 removes its screen, then nothing calls it.
- Tests:
  - backfill on a fixture with every old status
  - duplicate check
  - a website quote from a known email lands on the existing row
  - acceptance opens exactly one file under retry

### PR 3 · The Lead 360 screens

- The Leads list, chips, tiles, search, the board.
- Capture Lead with More Details and the live duplicate check.
- The record: header, Next Step card, the four buttons, four tabs, the Done dialog.
- The request sheet with its stage bar.
- Schedule Meeting.
- General Enquiries (rename, Raise Lead with the duplicate check).
- Remove the Quote Requests, Opportunities and Meetings tabs and Settings › Pipeline Stages.
- Redirects (§5.6), registry, dictionary keys moved for renamed labels, My Workspace task deep link.
- Prose, Title Case and dash gates clean on every touched file.

### PR 4 · Quotations absorb Proposals (backend)

- Migrations for §4.6 with the proposal migration.
- Sections, templates (seed **Standard**), output, language, Send through the mail engine, share
  link, view log, revise, expiry.
- The public `quotation_public` read, download, accept and decline on the signature programme
  (recipient email as the counterparty; portal clients through `portal_signing.js` as today).
- Accept → `quotation.accepted:win-request` (from PR 2).
- The AI draft moves from `proposal.generator.js`.
- One document template, Full and Extract.
- Delete the `proposal` and `proposal_public` services, keeping read-only token resolution for old
  proposal links.

### PR 5 · Company Profile (full stack)

- Migrations for §4.7.
- The editor (§3.6), versions and publish, the derived refresh, the logo library, Case Stories from
  Success Stories.
- The PDF template, share links with open tracking and the public `/profile/<token>` page on
  public-web.
- Writing a share and its opens to the lead's Activity when a `lead_id` is set (reads
  `lead_activity` if PR 2 has merged; otherwise the share stores `lead_id` and PR 6 adds the
  timeline entry).
- Delete the JSON text boxes.

### PR 6 · Quotation editor, templates, public link and portal

- The Quotations list and editor (§3.4) with live preview, the Full | Extract switch, the sections,
  Draft With AI, Send, Revise.
- The Templates screen (§3.5).
- **New Quotation** from the lead and the request (PR 3's buttons go live).
- public-web: `/q/<token>` replaces the proposal page.
- Portal: Proposals removed, Quotations lists every quotation.
- Remove the Proposals tab and its client files.
- About Us from the published profile.

### PR 7 · Drop the retired tables

- The PR 7 list in §4.8, with DESTRUCTIVE markers.
- Delete the `opportunity` module, `proposal-*` leftovers, Pipeline Stages backend.
- Retire MOD-23 and MOD-24.
- Update `doc/SALES_CRM_FEATURES.md` with a superseded note pointing here.

### Start prompt (one fresh session per PR)

```
Read CLAUDE.md, then doc/SALES_CRM_LEAN_REVAMP_GUIDE.md in full. Its §2 decisions are final;
do not re-ask them. Build PR <N> exactly as §7 describes, using only its migration numbers, and
keep every rule in §6. Run `npm run ci` before pushing. Open one pull request to main with the
title §7 gives it. In §9, tick PR <N> and add one line to the log: date, what was done, what is left.
```

---

## 8. Test and rollout

- **Backfill fixtures** cover every old lead, request, opportunity and proposal status, a client
  with two leads, and an opportunity with no request.
- **Acceptance under retry** opens one file, converts one client, wins one request.
- **The loop:** Done with a next step; Done without one refused on an open lead; Archive allowed.
- **Website:** the same email twice gives one company row and two requests.
- **Parity:** the preview, the public page and the PDF of one quotation in Full and Extract, EN and
  FR, show the same numbers.
- **Rollout:** staging walk with SMART after PR 3 (Leads alone is already useful), again after
  PR 6. Then a short training video on the Leads loop (`doc/TRAINING_VIDEOS.md`). The measures in
  §0 are read 30 days later.

---

## 9. Checklist and log

- [x] PR 1 · Remove Campaigns and Partnerships & Vendors
- [x] PR 2 · One company row, the request carries the deal
- [ ] PR 3 · The Lead 360 screens
- [ ] PR 4 · Quotations absorb Proposals
- [ ] PR 5 · Company Profile
- [ ] PR 6 · Quotation editor, templates, public link and portal
- [ ] PR 7 · Drop the retired tables

| Date | PR | What was done · what is left |
|---|---|---|
| 17/11/2026 | plan | Audit, eleven owner decisions, this plan. Nothing built yet. |
| 17/11/2026 | PR 1 | Campaigns (MOD-22), Partnerships & Vendors, the website newsletter and the Inbound intake signpost removed; migration 14500, seeds 9026 and 9160; old URLs redirect. MOD-22 retired; MOD-23 and MOD-24 stay until PR 7. Next: PR 2 and PR 5 in parallel. |
| 17/11/2026 | PR 2 | Company row (OPEN/ARCHIVED, next step as a workspace task, duplicate check, capture, Done, Archive/Reopen, Make Client, paged list, 360 with Activity/Requests/Quotations), request as the deal (stage machine, Lost reasons, Mark Won, auto moves), one win function + `quotation.accepted:win-request` (replaces `opportunity-won-open-dossier`), website/portal/enquiry find-or-create, meetings on the calendar, `sales.default_owner`, gap 11, KPIs, AI, search; migrations 14510 to 14516. Opportunity writes retired, its screen read only. No CHECK or FK on the existing tables (13791 rule): the vocabularies are held by the services. Left for PR 3: the Settings field for the default sales owner, `?done=` and `?request=` deep links, redirects and `entity-route` for old opportunity links. |
