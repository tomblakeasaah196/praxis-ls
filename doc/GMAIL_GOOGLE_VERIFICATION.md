# Gmail connection: Google setup and approval runbook

How the "Connect Google Workspace / Gmail" route is switched on, and what
Google needs before anyone (not just listed test users) can use it without a
warning screen. Google Cloud project: **Praxis LS Mail** (`praxis-ls-mail`).

## 1. What must be true for one company to connect Gmail

| Piece | Where | State on 16 Nov 2026 |
| --- | --- | --- |
| Gmail API enabled | Google Cloud → APIs & Services | Done |
| OAuth client (Web application) | Google Auth Platform → Clients | Done ("Praxis LS") |
| Authorized redirect URI | on that client | `https://praxisls.com/api/tenant/mail/oauth/google/callback` |
| Scopes declared | Google Auth Platform → Data Access | `openid`, `userinfo.email`, `gmail.modify` (restricted) |
| Branding: name, privacy, terms | Google Auth Platform → Branding | "Praxis LS", `/privacy`, `/terms` |
| Client ID + secret + redirect URI in the app | Platform Console → Integrations → Google Workspace / Gmail (or `GOOGLE_*` env) | **To do**: save, then press Test |
| Company switched on | Platform Console → tenant feature `mail.provider.google` | **To do**: per company |

The redirect URI saved in Platform Console must be **exactly** the one on the
Google client. One address serves every tenant; the tenant travels in the
signed `state`, not the host.

## 2. Publishing status: Testing vs In production

- **Testing**: only addresses on Audience → Test users can sign in (100 max),
  and Google **expires their refresh tokens after 7 days**, so a test mailbox
  disconnects weekly and must be reconnected. Fine for trying it out only.
- **In production, unverified**: anyone can sign in, but sees "Google hasn't
  verified this app" and must click *Advanced → Go to Praxis LS*. Capped at 100
  users over the app's lifetime. Some Google Workspace organisations block
  unverified apps outright unless their admin trusts the app.
- **In production, verified**: no warning, no cap. Requires section 3.

Press **Publish app** (Audience) only once `https://praxisls.com/privacy` and
`/terms` are live, since Google's reviewers follow those links.

## 3. Verification (restricted scope `gmail.modify`)

Google's checklist for a restricted scope, and what to prepare:

1. **Domain ownership**: verify `praxisls.com` in Google Search Console with
   an account that is an Owner/Editor on the Cloud project.
2. **Home page**: `https://praxisls.com` must identify the app and link to the
   privacy policy (the sign-in page footer does).
3. **Privacy policy**: `/privacy` has the Google user data section and the
   Limited Use statement. Keep it true to what the code does (see the header
   of `client/src/features/legal/legal-content.ts`).
4. **Scope justification**: why `gmail.modify` and not a narrower scope.
   Praxis LS reads the inbox, sends and replies from the user's address,
   and applies labels/read state the user sets inside the app. Read-only or
   send-only scopes cannot do all three.
5. **Demo video** (unlisted YouTube link): show the OAuth consent screen with
   the app name and the scopes in the URL, then each use of Gmail data in the
   app: inbox list, opening a message, sending a reply, labelling or archiving,
   and disconnecting the mailbox.
6. **Security assessment (CASA)**: required every 12 months for restricted
   scopes, done by a Google-approved third-party assessor, usually paid. Google
   tells you which tier and how to start once the review reaches that stage.

Submit from Google Auth Platform → **Verification Center**. Reviews usually
take several weeks; Google replies by email to the developer contact
(`praxisjbs@gmail.com` today), so watch that inbox.

## 4. Commitments the privacy policy makes. Keep them true

- Google user data is never used to train generalised AI/ML models, and is
  only sent to AI providers that do not train on it. Check the terms of every
  AI vendor the mail assist features can route to.
- Tokens are encrypted at rest (they are, in the tenant vault).
- Deletion on request within 30 days.
- No human reads mail except on request, for security, or by law.

## 5. Google's quota, and how fast a mailbox loads

Google meters the Gmail API in quota units, **per mailbox, per minute**. For a
Cloud project created after 1 May 2026 (this one) the limit is **6,000 units**;
it was 15,000 before. Reading one full message costs **60**, an attachment 20,
a send 100
([reference](https://developers.google.com/workspace/gmail/api/reference/quota)).
That is about **100 message reads a minute** for a mailbox, shared between the
sync and whatever its owner is doing.

What follows from that:

- **A first load is gradual, newest first.** A sync run spends at most 70% of
  the minute (about 70 messages across all folders, the Inbox getting up to
  half) and carries on next minute from where it stopped. A mailbox with
  10,000 messages takes a few hours to load fully. New mail still arrives
  within a minute, because it is read before the backlog.
- **"Slow down" from Google is not an error.** If the limit is hit anyway (two
  runs in a minute, a busy user), the run keeps what it read and resumes. A
  folder shows an error only for a failure that is not about rate, and then in
  Google's own words.
- **To load faster, ask Google for more.** Google Cloud → APIs & Services →
  Gmail API → *Quotas & System Limits* → "Units per minute per user" → edit and
  request a higher value (15,000 was the old default). Approval is Google's
  decision. If it is granted, raise `UNITS_PER_MINUTE` in
  `src/modules/mail/mail/providers/gmail.provider.js` to match.

Where to look when a Gmail mailbox misbehaves: Google Cloud → Gmail API →
*Metrics* shows every call by method and response code. A burst of 403s on
`GetMessage` / `GetProfile` with `ListLabels` still succeeding is the quota.
