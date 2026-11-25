# SMART LOGISTICS AND SERVICES: website v2, engineering guide

Owner of the job: JBS Praxis (Praxis LS). Client: SMART LOGISTICS AND SERVICES (tenant `smartls`).
Started 25 Nov 2026 from the CEO review of 24 Nov 2026. This file is the single brief every PR
session works from. Read it in full before touching code, then read the repo `CLAUDE.md`.

Where the work shows: `staging.smartls.cm` is served by PRODUCTION (51.254.165.120), so a merge to
`main` reaches it about 20 minutes later (CI on main, then the Deploy workflow; the live commit is
`build.commit` at https://praxisls.com/api/health). `smartlsgroup.com` is pointed at the site only
after the owner approves the finished result (section 9).

---

## 1. The standard

The owner's test, applied to every line of copy, every idea and every label:

> Landor and Pentagram were hired and paid USD 100,000 to position this brand so it brings real
> business and opens doors to partnerships. Does this read like their work?

Nothing may read as written by AI. Concretely:

- **Name.** The brand is SMART LOGISTICS AND SERVICES (short form SmartLS where space is tight).
  Never "Group", "subsidiary", "branch", "sister company", and never anything that says the two
  companies are legally separate or share an owner. That fact lives only in the footer (two legal
  names, two addresses) and in the Impressum.
- **Position.** Europe and Central Africa, then the world. We stand at both ends of the Europe to
  Central Africa trade (Douala and Kribi on one side, Mannheim on the other) and reach Asia, the
  Americas and the rest of Europe through our partner network. CEMAC stays visible because CEMAC
  importers are a primary audience and it is what search engines match.
- **Audiences, in this order of care:** overseas agents and forwarders (JCTrans now, WCA from early
  2027) checking us before handing over cargo; NGOs, UN agencies and project shippers checking
  policies and heavy-cargo capability; importers in Cameroon and CEMAC.
- **Voice.** Plain, exact, quietly confident. Short sentences. Real nouns: the Douala quay, Kribi,
  the Ngaoundéré railhead, N'Djamena, Bangui, the Rhine at Mannheim, a bill of lading, a T1, a bond.
  Verbs that do things. Claims only where we can show them.
- **Banned:** leading, unparalleled, seamless, world-class, cutting-edge, one-stop, solutions,
  robust, elevate, unlock, navigate the complexities, in today's fast-paced world, landscape,
  tapestry, delve, "not just X but Y", lists of three adjectives, rhetorical questions as headings,
  exclamation marks, and em dashes or double dashes anywhere a tenant reads (CLAUDE.md rule six).
- **Repo copy rules still apply:** chrome in Title Case, messages in sentence case, supporting text
  behind an ⓘ (rule five), every string through the dictionary.

If a line could sit on any other forwarder's website unchanged, rewrite it.

---

## 2. What the meeting decided (24 Nov 2026), and the owner's 20 answers (25 Nov 2026)

Meeting (Tom-Blake Asaah with the CEO, Timothée Massomba):

1. No French at all. The site is English only. No language switcher.
2. Retire the top rail above the header (track link, duplicate Client Portal, EN/FR).
3. Hero speaks to worldwide reach with the European presence, keeping CEMAC.
4. Track box helper reads simply, along the lines of "Enter your file reference".
5. Hero buttons: Request a Quote and Contact Us. A floating message button on every page: the
   visitor gives an email first (kept for the browser session), then writes; it reaches info@.
   Bot and spam protection is mandatory.
6. Homepage service text shortened to one or two lines; full detail stays on the service page.
   Body text white, the closing line in orange.
7. Services grouped into families. International Freight: Sea Freight, Air Freight, Project and
   Break-bulk (kept as its own service: project shippers want to see it). Inland Transportation:
   Hinterland Transit (name kept), inland road, Rail, Warehousing. Rail in Cameroon does not reach
   Chad or the CAR; it runs Douala, Yaoundé, Ngaoundéré, and cargo continues by road. Customs and
   Related Services: Customs Brokerage, Business Representation. No "end to end" labels on the site.
8. No case studies (confidentiality, and volumes are not yet where they would impress). A scrolling
   band of client logos instead.
9. Network, Corridors and Portfolio removed. Careers moves from the header to the footer.
10. "What working with us looks like" gets real imagery instead of icons.
11. The German company is entered as a corporate entity; the About page reads it automatically.

Owner's answers (25 Nov):

| # | Topic | Decision |
|---|---|---|
| 1 | Name | SMART LOGISTICS AND SERVICES. Footer carries both legal names with addresses. |
| 2 | Position | Europe and Central Africa, then the world. |
| 3 | Audience | Overseas agents and forwarders; NGOs, UN and project shippers; importers in Cameroon and CEMAC. |
| 4 | Mannheim offers | Export consolidation to Africa; buying and sourcing support; road freight within Europe; imports into the EU through the partner network. |
| 5 | Client logos | All eight now: UNFPA, MINUSCA, Magil, FMA, FM Logistics, GIZ, L&T, Tata Projects. Carriers (Maersk, MSC, CMA CGM, Hapag-Lloyd, DHL) are not presented as clients. |
| 6 | Networks | JCTrans now; WCA built as configuration so it is switched on with its member number later, no code. |
| 7 | Figures | Only figures we can stand behind (see section 8). |
| 8 | Trust documents | The five policies (Quality, HSE, ESG, Code of Conduct, Anti-Corruption) drafted, designed and published with a Publish button. No signatures. |
| 9 | Build style | Per-tenant switches, DEFAULT OFF until a tenant turns them on. Nothing is deleted from the product. |
| 10 | Services | A website service layer over the ERP service types; ERP types untouched. |
| 11 | Reach | No reach, network or corridors section at all. |
| 12 | Look | Light pages with dark photographic bands, plus a visitor dark-mode switch. Images editable in Settings › Website. |
| 13 | Quote engine | "Do you know your Incoterm?" Yes: pick it. No: plain questions reveal, and the answers select the Incoterm automatically. Maps to the exact in-house service type. Must be very solid. |
| 14 | Article dates | Dated to the real events they discuss; company news only where it happened. |
| 15 | Article subjects | Europe and Africa trade rules; Douala, Kribi and the hinterland; project and heavy cargo. |
| 16 | Bylines | House byline plus named people, within the dates they held the role (section 7.4). |
| 17 | Messages | Email info@smartlsgroup.com and log in Praxis LS. Sent from support@smartlsgroup.com until a noreply sender exists. Attachments (PDF, images, documents) up to 20 MB. |
| 18 | Tracking | A reference must never be guessable. Replicate and harden the old system's approach. |
| 19 | Legal | Impressum and privacy policy naming both companies, in English and German. |
| 20 | Launch | Everything in these five PRs, visible on staging.smartls.cm, then moved to smartlsgroup.com on approval. |

---

## 3. What the code is today (facts every PR relies on)

- `public-web/` serves every tenant from ONE build. Anything removed in code is removed for every
  tenant; that is why decision 9 is "switches, default off".
- Copy: dictionary `public-web/src/lib/i18n-dict.ts` (en + fr), tenant overrides from
  `GET /public/site/copy` (`lib/site-copy.ts`, admin `client/src/features/settings/website-copy.tsx`).
  An override cannot be blank today (FR required, empty means "use shipped wording"). The meeting
  could not remove `site.services.sub` without code for that reason.
- French is the REQUIRED language in the data: `bi()` in the site content schema, service web
  profiles, insights (`title_fr` required) and entity stories; EN falls back to FR when blank.
- Header: hard-coded `NAV` in `public-web/src/components/site/site-header.tsx` (124-137); top rail
  310-346; `LangToggle` hard-codes en/fr (575-615). Scroll behaviour in `use-header-scroll.ts`.
- Theme: dark is forced (`FORCE_DARK = true` in `lib/theme-mode.ts`, `index.html` 32-58,
  `ThemeToggle` returns null). Tenant palette in `site_theme`.
- Homepage sections: `features/marketing/marketing-page.tsx` 139-189 (Hero with TrackWidget,
  AnnouncementsBand, ProofStrip, ServicesBand, HowBand, ProofBand, CorridorScene, PortalBand,
  QuoteBand, ContactBand). The PortalBand mock shows a sequential-looking `SBL-OPS-2026-0142`.
- Services: ERP `service_type` (import and export are separate types; key immutable; many FKs:
  dossier, milestone templates, quotations, quote requests, dictionaries). Website profile in
  `service_type_web_profile`; families in `service_type_web_group` (seeded freight / logistics /
  value-added). Homepage takes the first four published services' `short_description`.
- Contact: `POST /api/tenant/public/intake/contact-enquiries` creates a `contact_enquiry` and an
  in-app notification. **No email reaches anyone.** Anti-bot today: honeypot `website_url`,
  `form_started_at` under 1.5 s rejected, 5 per hour per `req.ip`. No captcha anywhere.
- `TRUST_PROXY_HOPS` is 1 and nothing reads `CF-Connecting-IP`. Behind a proxied Cloudflare record
  every visitor shares a Cloudflare edge IP, so one spammer would lock everyone out of the limits.
- Tracking: `src/modules/operations/tracking_public/` looks a file up by reference, rate limited
  30 per 15 minutes. References come from `src/services/documents/operation-reference.js`:
  `SL` + 12 Crockford Base32 characters from `crypto.randomBytes` + service code, the old system's
  `SL1615336SM` shape modernised. They are not guessable. What is missing is hardening around it.
- About: `features/about/about-page.tsx` reads `/public/site/about`, `/public/site/entities`,
  `/public/site/partners`. Hero copy "The people behind / the freight" is dictionary, and renders
  broken on staging ("The Men and Women the Freight").
- Partners: `site_partner` (carrier | client | network) can only go active with a
  `permission_note`. Credentials: `site_credential`. Logo strip block exists but is not rendered.
- Insights: `insight_article`; `published_at` is not writable and is stamped on publish; author
  must be an `app_user`; body is a Markdown subset; server head uses `title_fr`.
- SEO: client-rendered SPA; the server rewrites only the head (`src/shared/http/public-head.js`).
  Home, About and Services get only the tenant name as title and no description.
- Domains: `platform.subdomain` rows (host, surface erp|public). Added in the platform console
  (`platform-console/src/features/TenantDetail.tsx` DomainsCard). No www to apex redirect in code.
  The DNS check compares A records with the ingress IP, so a proxied Cloudflare record reads as
  `wrong_target`. The server's default HTTPS block (wildcard `*.praxisls.com` certificate) already
  answers for any host on 443, so Cloudflare proxied with SSL mode "Full" works without a new
  certificate on the server.
- Live content found that is WRONG: the pinned announcement "A European address for the Cameroon
  corridor" calls the German company a wholly owned subsidiary and a GmbH. It is a UG and must never
  be described as a subsidiary. Unpublish it; PR 5 replaces it.

---

## 4. The five PRs

Waves: PRs 1, 2 and 5 run in parallel now. PRs 3 and 4 start when PR 1 has merged, because they build
on its settings and its look. Each PR merges on green, deploys, and is checked on staging.

### PR 1: `feat(site): per-tenant website switches, English only, and the meeting's homepage fixes`

Owns: `site-header.tsx`, `site-footer.tsx`, `marketing-page.tsx`, `hero.tsx`, `contact-page.tsx`,
`about-page.tsx` hero only, `lib/theme-mode.ts`, `theme-toggle.tsx`, `lib/i18n.ts`, `page-shell.tsx`,
`packages/shared/schemas/site-settings.js`, `src/modules/site/*`, the website settings screens in
`client/`.

1. **Website switches** (per tenant, stored with the site settings, every optional switch DEFAULT
   OFF, editable in Settings › Website): languages offered (English only by default; French opt-in),
   top rail, portfolio pages and nav item, corridors and network scenes, case-notes band, careers
   in the header (footer link always stays), visitor dark-mode switch. Routes for a switched-off
   section return the not-found page and leave the sitemap.
2. **English first.** When a tenant offers only English, every bilingual field requires English and
   French becomes optional, across site content, service web profiles, entity stories and copy
   overrides. Public reads never fall back to French for that tenant. Build one shared helper for
   "the tenant's required language" so PRs 3, 4 and 5 use the same rule.
3. **No switcher** when one language is offered: header, mobile drawer, footer, service pages,
   portal sign-in and account, `?lang=` ignored, `<html lang="en">`.
4. **Copy can be hidden.** A copy override gains an explicit "hide this line" state, and every
   renderer of an optional line collapses cleanly with no empty gap. This is what the CEO tried to
   do with the services subtitle.
5. **Header:** top rail behind its switch (off), one Client Portal button only, main bar unchanged.
6. **Hero:** buttons Request a Quote and Contact Us. Fix the doubled title ("Forward" printed twice).
   Track helper default "Enter your file reference." (overridable).
7. **Homepage:** case notes, corridors and network behind their switches (off). PortalBand mock uses
   the real reference shape (`SL` + 12 characters + code), never a sequence.
8. **Contact page:** drop "Where we deliver" coverage. Show the offices from the public entities with
   full address, phone and email.
9. **Light by default.** Unforce dark; light pages with dark photographic bands. The visitor switch
   appears only when the tenant turns it on (SmartLS: on). `check:contrast` must pass in both.
10. **About hero** renders correctly (PR 4 rewrites the page; PR 1 only fixes the break).
11. **Footer:** both legal names with registered addresses (from public entities), Careers, legal
    links slot (filled by PR 4).
12. Seed nothing tenant-specific in migrations. Settings for SmartLS are set through the admin screen
    after deploy (section 6).

Migrations: tenant `14600`-`14619`, platform `0120`-`0121`, seeds `9170`-`9174`.

### PR 2: `feat(site): message button with attachments, spam shield and real visitor addresses`

Owns: new `public-web/src/components/site/message-button.tsx` (mounted once in the marketing layout,
not the portal), `contact-form.tsx`, `lib/intake-api.ts`, `src/modules/sales/public_intake/*`,
`inbound_intake`, the rate limiter and trust-proxy code, `tracking_public`, the platform DNS check.

1. **Message button** on every marketing page. Step one: email (validated), remembered in
   `sessionStorage` for the browser session. Step two: message plus optional name, company, phone,
   and attachments. Shows the reference on screen when sent. Keyboard and screen-reader complete,
   reduced-motion safe, does not cover the cookie-free page content on phones.
2. **Attachments** on the message button and the contact form: PDF, JPG, PNG, WEBP, HEIC, DOCX, XLSX,
   up to 20 MB in total, through the upload engine (`FilePicker` + `UploadList` +
   `useUpload({ autoStart: false })`, profile `document`, so scans are never auto-levelled). Stored in
   the vault against the enquiry; type sniffed server-side, not trusted from the extension.
3. **Email delivery.** Each enquiry emails the tenant's website inbox (new setting; SmartLS:
   info@smartlsgroup.com) with the visitor as Reply-To, the reference in the subject, the message, and
   the attachments (attached when the total fits the mail limit, otherwise as expiring signed links).
   The visitor receives a short acknowledgement with their reference. Sender: the tenant's outbound
   mailbox setting; SmartLS uses support@smartlsgroup.com through Zoho (`smtppro.zoho.com:465` SSL)
   until a noreply sender exists. The owner types the mailbox password into the product himself.
   Still logged in Praxis LS as today.
4. **Spam shield.** Cloudflare Turnstile on the message button, contact form, quote wizard submit and
   careers application, verified server-side (`siteverify`) with keys held in settings (the secret is
   stored encrypted and never returned to the browser). Honeypot and timing stay. Without keys the
   site still works on honeypot and timing alone, so staging never breaks.
5. **Real visitor address.** Read `CF-Connecting-IP` only when the request reached us from Cloudflare's
   published ranges; otherwise use today's logic. Every public limiter keys on the real address. The
   platform DNS check accepts a Cloudflare-proxied record as correct.
6. **Tracking, hardened.** Audit that every live dossier reference came from the random allocator.
   Normalise input the Crockford way (case, spaces, dashes, O to 0, I and L to 1) so a dictated
   reference still matches. Identical response and similar timing for "not found" and "malformed".
   Limits on the real address. Tests that fail if a sequential or `Math.random` reference ever appears.

Migrations: tenant `14620`-`14639`, platform `0122`-`0123`, seeds `9175`-`9179`.

### PR 3: `feat(services): service families on the website and the Incoterm engine in the quote`

Starts after PR 1 merges. Owns: `service_type_web*` modules, the services pages, `nav-services-panel`,
the quote wizard and `lib/quote-*`, `packages/shared/schemas/quote-request.js`, quote intake.

1. **Website services over ERP types.** A website service (slug, name, one-line homepage text, full
   copy, cover, accent, closing line, family, featured flag, order) maps to one or more ERP service
   types. The ERP types and their keys are untouched. Families and services:
   - International Freight: Sea Freight; Air Freight; Project and Break-bulk.
   - Inland Transportation: Hinterland Transit; Road Transport; Rail Transport; Warehousing.
   - Customs and Related Services: Customs Brokerage; Business Representation.
   - Europe: Export Consolidation to Africa; Purchasing and Sourcing; European Road Freight; EU Import
     Clearance (through partners).
   Where an ERP type does not exist for a website service (the Europe four), the mapping points at a
   type created in Master Data, never at a migration with tenant data.
2. **Homepage:** featured services, one line each, white text, closing line in orange, a link to the
   full page and to All Services.
3. **The Incoterm engine.** One module in `packages/shared/rules/` used by the wizard and the API:
   - The visitor picks a website service, then direction (importing or exporting), then answers
     "Do you know your Incoterm?".
   - Yes: pick from Incoterms 2020, filtered by mode (FAS, FOB, CFR, CIF are sea and inland waterway
     only).
   - No: plain questions reveal. "Are you buying or selling?", "Where should our work begin?"
     (supplier's premises; port or airport of loading; port or airport of arrival), "Where should it
     end?" (port or airport of arrival; your premises; your premises with duties paid). The answers
     select the Incoterm and say it in plain words ("This is EXW: we collect from your supplier").
     "Not sure" is always allowed and routes to the desk.
   - The engine then resolves the exact in-house service type and the scope (origin pickup, export
     clearance, main carriage, import clearance, duties and taxes, final delivery). Example: Sea
     Freight + importing + DDP or EXW resolves to End to End Sea Freight; Sea Freight + importing +
     CIF resolves to Sea Freight Import, because the seller has paid the voyage.
   - The mapping table is data (editable in Master Data, defaults seeded generically) and validated:
     every combination resolves to exactly one type or to "desk review", proven by an exhaustive test
     over every service, direction, party, start, end and Incoterm.
   - The quote request stores the website service, direction, Incoterm, how it was chosen (picked or
     derived), the derived scope and the resolved type, so the desk sees why.
4. Service copy rewritten to the standard in section 1 (content in section 6).

Migrations: tenant `14640`-`14659`, seeds `9180`-`9184`.

### PR 4: `feat(site): brand, About, trust documents, partners and German legal pages`

Starts after PR 1 merges. Owns: `about-page.tsx`, `proof-bands.tsx`, `footer-extras.tsx`, new
partners, trust and legal pages, image slots, `public-head.js` outside the insights routes, the
partners, credentials and about admin screens.

1. **Visual system:** light pages, dark photographic bands, a disciplined type scale, the logo's
   orange and blue as accents only. Brand colours taken from the logo file and confirmed with the
   owner (the repo holds three different oranges: `#F5821F`, `#EE7D04`, `#FF5A00`).
2. **Editable images** in Settings › Website for every photographic slot (hero, families, the three
   "working with us" steps, About bands, partners band, trust band), via `<ImageUpload>` with profile
   `photo`, AVIF/WebP derivatives. "What working with us looks like" uses images, not icons.
3. **Client logo band** on the homepage: the eight logos, scrolling, grayscale until hover, static
   under reduced motion. Each partner's permission note records "Approved by the CEO, review of
   24 Nov 2026". Logos can be taken from the old site's own assets (`https://smartls.cm/assets/logos-webp/`).
4. **Memberships** configurable (name, member number, logo, link, published): JCTrans on now, WCA
   ready to switch on with its number.
5. **About page rebuilt:** a statement, the story (customs brokerage in Douala in 2021, a full
   forwarding house since, Mannheim in 2026), how we work, leadership with real photos only, the two
   offices, clients, memberships, trust documents. No invented people; AI imagery never stands in for
   staff.
6. **Trust documents:** the five policies as website documents with Draft and Published states and a
   Publish button, each rendered as a page and as a designed PDF. A Trust and Compliance page lists
   them. Content drafted to the standard (section 6).
7. **For Partners page** for agents and forwarders: what we handle and where (Douala, Kribi, the
   hinterland to Chad and the CAR, Mannheim for Europe), how to nominate a shipment, memberships,
   named contacts, a partnership form (enquiry type "Agency or vendor partnership").
8. **Legal pages:** Impressum (Germany, § 5 DDG) and Privacy Policy (GDPR, and Cameroon's personal data
   law), English and German, generated from the corporate entities (legal name, legal form, address,
   managing director, register court and number, VAT ID, contacts). Footer links. Only these pages
   have a German version.
9. **SEO groundwork:** server-side title, description, canonical and Open Graph image for home, about,
   services, each service, partners, trust and legal pages, from `site_page` and service metadata;
   Organization JSON-LD with both offices; sitemap updated. No hreflang (English only).
10. Unpublish the wrong "subsidiary GmbH" announcement if PR 5 has not already replaced it.

Migrations: tenant `14660`-`14679`, seeds `9185`-`9189`.

### PR 5: `feat(insights): the Insights library from 2021 to 2026`

Owns: `src/modules/content/insight*`, `features/insights/*`, `lib/insights-api.ts`, the insights
routes in `public-head.js`, the article admin screens.

1. **Publish date** can be set by an editor (past allowed; a future date schedules).
2. **Byline** is a name and a role written on the article (optionally linked to a staff user and a
   photo), because several authors are former staff or hold dated roles.
3. **Language:** at least one of English or French required (PR 1's shared helper replaces this once
   merged). Server head uses `meta_title` / `meta_description` and English first.
4. **Import:** Settings › Website › Articles › Import takes Markdown files with front matter (title,
   slug, date, kind, tags, byline, role, excerpt, meta) and creates drafts for review.
5. **Public pages:** a lead article, tag filter, year archive, reading time, byline with role, related
   articles, share to LinkedIn, WhatsApp and email, per-article Open Graph image.
6. **Content:** the 18 articles in section 7, researched and correct as of their dates.

Migrations: tenant `14680`-`14699`, seeds `9190`-`9194`.

---

## 5. How every session works

- Branch from `main` in your own worktree. PR titles use a Conventional Commits prefix.
- **Do not start subagents or workflows.** This PC has crashed with too many agents; three sessions
  already run at once.
- `npm run ci` cannot run on this Windows PC. Run the gates one by one
  (`node scripts/ci-local.js --list`). Run jest with
  `--modulePathIgnorePatterns="<rootDir>/.claude/"` and eslint with `--ignore-pattern ".claude/**"`.
  Read each gate's own exit code (redirect to a file, save `$?`).
- Generated docs: run `node scripts/generate-api-docs.js` after adding an `AppError` or a route.
- `client` test `mail.legacy-removed.test.tsx` fails only on Windows; ignore it.
- Migration numbers: stay inside your range above. Rebase on `main` before opening the PR.
- Push, open the PR, then watch CI with one background `gh pr checks <n> --watch`. Fix failures.
  **Authority to merge when every check is green was given by the owner for these five PRs.**
  Squash-merge, then confirm the deploy (`build.commit` on https://praxisls.com/api/health) and check
  the change on https://staging.smartls.cm in the browser pane (press the "New version available"
  banner until it stops returning). Take a screenshot as proof.
- Never print or ask for secrets. The owner types passwords and keys into the product's own screens.
- Wire every changed module to the AI manifest (`<module>.ai.js`) and the search registry, per
  CLAUDE.md.
- When done, report: PR link, what changed in plain English, what was checked on staging, and what
  the owner must still provide.

---

## 6. Content (written to section 1, entered after each PR deploys)

Content is entered through the product's own admin screens on the LIVE environment (public reads are
pinned to LIVE). Drafts are kept beside this guide in `doc/smartls-website/content/` for the owner to
read before they go in.

- **Hero direction.** Eyebrow: Sea, Air, Inland, Customs. Headline in the spirit of "From Europe to the
  heart of Central Africa." Lead: one sentence naming Douala, Kribi and Mannheim and the reach beyond.
  Not "Freight that moves your business forward", which any forwarder could print.
- **Services:** every page states what we do, where, the documents involved, and what the client
  receives, in that order. Hinterland Transit names the real route (rail to Ngaoundéré, then road to
  N'Djamena; road to Bangui). Rail Transport says where the line runs and where it stops.
- **Tagline** "Going beyond your expectations" is the company's heritage line; keep it in the footer
  and the signature only.

---

## 7. The Insights library

### 7.1 Rules

- Dated to the moment its subject happened, and true as of that date: no knowledge from later.
- Company news only where it really happened (founding in 2021, Mannheim in 2026).
- No client named without consent; lessons are told as situations.
- Every fact checked against a primary source before writing (the EU's own pages for EU rules; port,
  customs and carrier announcements). Where a date below is marked (verify), confirm it first.

### 7.2 Roster (18)

| # | Date | Title (working) | Byline | Subject |
|---|---|---|---|---|
| 1 | Mar 2021 | Why We Started With Customs | Timothée Massomba, Managing Director | Company |
| 2 | Jun 2021 | The Free Trade Area Is Open. What Changes at the Douala Quay, and What Does Not Yet | Smart Logistics and Services | Trade rules |
| 3 | Nov 2021 | Douala or Kribi: Choose the Port Before You Choose the Vessel | Joseph Moukoko, Operations Manager | Ports |
| 4 | Apr 2022 | From the Douala Quay to N'Djamena: Rail to Ngaoundéré, Then the Road | Clovis Tiako, Operations Officer | Hinterland |
| 5 | Sep 2022 | What a Container Held in Port Really Costs | Tom Forghab, Head of Finance and Strategy | Ports, finance |
| 6 | Jan 2023 | A New Owner for the Region's Largest Logistics Network: What Shippers Should Watch (verify: MSC completed the purchase of Bolloré Africa Logistics in Dec 2022) | Tom Forghab, Head of Finance and Strategy | Trade |
| 7 | Jul 2023 | The EU Deforestation Regulation, Read From Cameroon (in force 29 Jun 2023) | Timothée Massomba, Managing Director | Trade rules |
| 8 | Oct 2023 | Out-of-Gauge Into Central Africa: What to Settle Before the Vessel Sails | Joseph Moukoko, Operations Manager | Project cargo |
| 9 | Feb 2024 | Around the Cape: What the Red Sea Diversions Did to Transit Times Into Douala | Aurelie Kuikeu, Head of Operations and Growth | Ocean |
| 10 | May 2024 | Why Your European Freight Invoice Now Carries an Emissions Line (EU ETS for shipping from 1 Jan 2024) | Tom Forghab, Head of Finance and Strategy | Trade rules |
| 11 | Sep 2024 | Relief Cargo to Bangui: Lead Times You Can Actually Plan Around | Aurelie Kuikeu, Head of Operations and Growth | Hinterland |
| 12 | Mar 2025 | ICS2 for Ocean Freight: The Data Europe Wants Before Your Container Is Loaded (verify dates) | Smart Logistics and Services | Trade rules |
| 13 | Jul 2025 | The Clean File: What Customs in Douala Should Never Have to Ask For | Line Happy (role to confirm) | Customs |
| 14 | Nov 2025 | Budgeting a Project Shipment: The Costs That Arrive After the Freight | Luc Nana, Finance Controller | Project cargo |
| 15 | Jan 2026 | The Deforestation Rule's New Deadline, and How Exporters Should Use the Time (verify the latest postponement) | Timothée Massomba, Managing Director | Trade rules |
| 16 | Jun 2026 | Heavy Lift Through Kribi: Planning a Transformer Move Inland | Joel Efala (role to confirm) | Project cargo |
| 17 | Oct 2026 | Smart Logistics and Services Opens in Mannheim | Vanessa Mezakeu, Director, Smart Logistics and Services UG | Company news |
| 18 | Nov 2026 | Shipping From Germany to Central Africa: A Practical Guide for European Exporters | Vanessa Mezakeu, Director, Smart Logistics and Services UG | Trade rules |

### 7.3 Form

800 to 1,400 words. A headline that states something, a two-sentence standfirst, subheads that carry
the argument, one practical list where it helps, a closing paragraph that tells the reader what to do.
Tags from a small fixed set: trade-rules, ports, hinterland, project-cargo, customs, europe, company.

### 7.4 Bylines and their dates

| Person | Role on the byline | May sign |
|---|---|---|
| Timothée Massomba | Managing Director | any date |
| Tom Forghab | Head of Finance and Strategy | 2022 to 2024 only |
| Aurelie Kuikeu | Head of Operations and Growth | 2024 only |
| Clovis Tiako | Operations Officer | any date (confirm start) |
| Joseph Moukoko | Operations Manager | any date (confirm start) |
| Joel Efala | role to confirm | any date |
| Line Happy | role to confirm | 2025 onward |
| Luc Nana | Finance Controller | 2025 onward |
| Vanessa Mezakeu | Director, Smart Logistics and Services UG | 2026 onward |
| Smart Logistics and Services | house byline | any date |

---

## 8. Figures

The old operations registry holds 57 files from Feb to Nov 2026 (34 won, 18 clients, 16 of them
hinterland transits to the CAR). Records before 2026 were not kept there, so raw counters would read
small and cannot be evidenced. Launch instead with a credentials row that is true and checkable:
established 2021; offices in Douala and Mannheim; the ports of Douala and Kribi; the inland reach
(Cameroon, Chad, the Central African Republic and further CEMAC destinations as the owner confirms).
Turn on live counters fed by Praxis LS once a full year of files is recorded there. A growth claim
("2026 doubled 2025") is used only if the accounts show it.

---

## 9. Pointing smartlsgroup.com (only after the owner approves)

1. Platform console: add `smartlsgroup.com` and `www.smartlsgroup.com` to tenant `smartls`, surface
   `public`.
2. Cloudflare (owner's account, already signed in): A records `@` and `www` to `51.254.165.120`,
   proxied; SSL/TLS mode Full; a redirect rule from www to the apex. Mail records (Zoho MX, SPF,
   DKIM `zmail`, DMARC) stay exactly as they are.
3. `smartls.cm` (cPanel at Newton Corp): replace the old site with permanent redirects to the same page
   on smartlsgroup.com (`/services`, `/about`, `/smart-track` to `/track`, `/smart-quote` to `/quote`,
   `/kaizen` to `/insights`). Mail for smartls.cm (Zoho aliases) is untouched.
4. staging.smartls.cm stays, blocked from search (`robots.txt` already disallows everything).
5. Then SEO work begins (Search Console, the sitemap, the Google Business profiles for both offices).

---

## 10. What the owner still has to provide

- German company: register court and number (HRB), managing director, VAT ID, phone and the email for
  Europe enquiries. The CEO can enter them on the German entity in Praxis LS.
- JCTrans member number.
- Roles for Joel Efala and Line Happy; start dates for Clovis Tiako and Joseph Moukoko.
- Logo as a vector file (SVG, AI or PDF), and the official colours if they exist.
- Real photographs of the team for the About page; the generated scenes from `IMAGE_PROMPTS.md`.
- The support@smartlsgroup.com password typed into the product's mail sender screen, and the
  Turnstile keys once PR 2 lands.
