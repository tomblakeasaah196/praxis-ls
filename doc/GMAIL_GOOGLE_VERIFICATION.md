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
