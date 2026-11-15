# Training videos

**Start here when asked for a training or introduction video** ("make the finance video", "make the
warehouse video"). Every video looks and sounds like the first one: the same
cards, the same caption bar, the same phone frame, the same voice at the same pace. This file is how
any session, in any chat, makes one, in order, and what has been learnt so far. Read all of it
before filming.

The tooling is `scripts/video/`. A video is one file in `scripts/video/scenes/<id>.js`: its script and
its choreography together. `tests/unit/video-tooling.test.js` pins the parts that can be tested on
paper (how a line is spoken, how a subtitle splits, the cast, that a scene is whole).

| Video | Scene | Status |
| --- | --- | --- |
| Introduction, part 1: Premiers pas (sign-in and the shell, desktop and phone) | `p1-first-steps.js` | Made 15/11/2026, 8:19, 10 chapters, sent to JBS Praxis; to upload (§5) |
| Introduction, part 2: Se connecter en toute sécurité (passkey, Quick PIN, lock screen, two-step) | `p2-secure-sign-in.js` | Made 15/11/2026, 5:46, 9 chapters, sent to JBS Praxis; to upload (§5) |

---

## 1 · What a session needs

The repository and **Node 20** (`npm ci` in the root and in `client/`), **ffmpeg**, **Chromium**, a
**PostgreSQL 16 with pgvector** and **Redis** on the machine, and the narration's **Python 3.12**.

1. **Node 20.** `.nvmrc` names it. Where the image has another, `npm install node@20` into a scratch
   folder and put its `node_modules/.bin` first on `PATH`.
2. **PostgreSQL with pgvector, Redis, the French voice's phonemiser.** In a cloud session:
   ```bash
   apt-get install -y postgresql-16-pgvector espeak-ng
   pg_ctlcluster 16 main start
   su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'changeme'\""
   redis-server --daemonize yes --save "" --appendonly no
   ```
   `espeak-ng` is what Kokoro uses to read French; without it the French voice fails.
3. **Python 3.12 for the voice** (spaCy, which Kokoro needs, does not build on 3.13). With no GPU,
   install torch's CPU build first: the default pulls several gigabytes of CUDA.
   ```bash
   uv venv -p 3.12 ~/.video-venv && . ~/.video-venv/bin/activate
   uv pip install torch --index-url https://download.pytorch.org/whl/cpu
   uv pip install -r scripts/video/requirements.txt
   ```
   Point `VIDEO_PYTHON` at `~/.video-venv/bin/python`.
4. **Network.** Kokoro downloads its model from `huggingface.co` the first time. A cloud environment on
   limited network access refuses it (`CONNECT tunnel failed, response 403`): allow `huggingface.co`
   and `cdn-lfs.huggingface.co`, or use full access while narrating.
5. **Chromium and Playwright.** Playwright is found on the module path, else in `client/node_modules`;
   Chromium is `PRAXIS_CHROMIUM`, else `CHROME_BIN`, else `/opt/pw-browsers/chromium`. Never
   Playwright's own download.

## 2 · The pattern

**The file.** 1920 × 1080, 30 fps, H.264; AAC mono 48 kHz at about 160 kb/s; loudness -16 LUFS.
MP4 tags: `title` "Praxis LS · <French title> / <English title> (Part N)", `artist` "JBS Praxis",
language `fra`. Chapters in the file, one per chapter of the script. Hard cuts, no fades. Beside the
MP4, two transcripts: `<file>.en.srt` and `<file>.fr.srt`, for a platform that wants a subtitle track.

**The frame.** The picture, 1920 × 960, above a caption bar, 1920 × 120. The bar carries the
**English subtitle** of the French line being spoken, centred; a long sentence shows in two halves
(split at `|`, else at the comma nearest its middle). On the left, "CHAPITRE 2 SUR 10" in the
tenant's orange, the chapter's French name in white bold and its English name under it, smaller.

**The cards.** The opening card wears the tenant's own brand (white-label software, so a video for
Smart LS is Smart LS's video): the login photograph under a navy veil, the logo on a white pill, an
eyebrow in the brand colour, the title in Plus Jakarta Sans at 128 px, a French subtitle, an English
line under it and a rule, "Conçu par **JBS Praxis**" at the foot. The closing card is the same with
"Merci" and the tenant's address. Narration starts on the opening card at once and ends on the closing.

**Desktop.** The app at 1536 × 768 CSS pixels, device scale 1.25, so it fills the picture exactly. A
drawn arrow glides to what is pressed. Real records, real clicks, nothing faked.

**Phone.** The app at 390 × 860 inside a dark phone body (outer 430 × 905, screen 394 × 869), on a
plain ground, with a label on the left: an eyebrow, a title (the person), a subtitle. No pointer: taps.

**The voice.** The narrator is French: Kokoro's `ff_siwis`, the only French voice Kokoro has (a
woman), at speed 0.95 (about 155 words a minute). **The application stays in English on purpose**, so
every name a viewer must find on the screen is spoken in English: anything between « and » in a line's
`fr` is read by the English voice (`bf_emma`), joined to the French with a breath, so a viewer hears
"Appuyez sur *Sign In*" with Sign In pronounced as the screen spells it. `SAID` in `make.js` says how
an English name is read (initials spelled, TEST read as a word, LIVE as the adjective). The words in
« » are shown in the French transcript with their guillemets and in the English subtitle in quotes.

**The script.** Present tense, plain words, one fact a sentence, about 20 words at most, "vous". It
follows a named person doing real work. Buttons, tabs and fields are named exactly as the screen reads
them: the screen sets many labels in capitals (SIGN IN) while the page holds them in sentence case, so
the hands match names in any case. It never explains how the system is built. Chapter 1 is Welcome: what
the video covers, the language rule, the cast. The last is Wrapping Up and says what the next video is.
**No em dash anywhere** (the owner's rule for everything a tenant reads, and a test pins it in scenes).

## 3 · The cast

Every person on screen is invented (`scripts/video/cast.js`): no member of a tenant's real staff is the
subject of a demonstration, so a video can be shown to anyone. They live on the LIVE side of the
filming copy (a login needs an employee record) and, because the product copies every live employee into
TEST, they are in TEST too. Their addresses are on `.test`, which can never reach a real mailbox.
Add people in `cast.js`, never in a scene, so the next video meets the same colleagues.

| Key | Person | Post | Roles |
| --- | --- | --- | --- |
| `patrick` | Patrick Etoundi | Managing Director | CEO |
| `nadege` | Nadège Tchouameni | Operations Manager | MANAGEMENT, OPERATIONS |
| `brice` | Brice Mbarga | Import Operations Lead | OPERATIONS |
| `carine` | Carine Fokou | Export Operations Lead | OPERATIONS |
| `serge` | Serge Ndzana | Finance Manager | FINANCE |

Nadège is the newest colleague (hired 02/11/2026): she is invited, not given a password, so a video can
show her accepting the invitation. Everyone else has the filming password (`VIDEO_PASSWORD`, default in
`ground.js`).

## 4 · Filming

### 4.1 · A database to film on

Never a deployed site, never a real tenant: filming creates records and signs people in. `ground.js`
refuses anything but a development database on this machine. On a fresh copy, in this order:

```bash
cp .env.example .env && sed -i 's/^REDIS_PASSWORD=.*/REDIS_PASSWORD=/' .env
npm run db:migrate:platform
npm run db:provision -- --slug=smartls --name="Smart Logistics & Services Ltd" --plan=full
( cd client && npm run build )          # the server serves client/dist only if it exists WHEN IT STARTS
npm start &  npm run worker &            # start them after the build, never before
node scripts/video/make.js p1-first-steps prepare
```

`prepare` is the scene's own: it applies the tenant's branding, creates the company record and the cast,
loads the TEST sample data (`scripts/tenant/seed-sandbox.js`, once) and issues a fresh invitation.
Filming's Chromium sends `smartls.praxisls.com` to the local server (`film.js`, `browserFor`), so every
address on screen reads as the tenant's own, never localhost. To reach the app outside filming, send the
host: `curl -H "Host: smartls.praxisls.com" http://127.0.0.1:8080/`.

**The tenant's look is real.** `scripts/video/brand/<tenant>/` holds what the tenant publishes to anyone
who opens its sign-in page: `branding.json` (name, palette, fonts, radius, from its public
`GET /api/tenant/branding`), `logo.webp`, `favicon.png` and `login-background.webp` (from its `/media`
URLs). They are applied through the product's own branding service, as Settings · Appearance would. The
repo's `scripts/tenant/seed-branding.js` is NOT what the real tenant wears (it seeds Montserrat and Inter;
the real tenant is set in Plus Jakarta Sans and Public Sans): read the public endpoint again when a tenant
changes its look. A new tenant is a new folder and `VIDEO_TENANT=<slug>`.

**LIVE has no data, TEST does.** A tenant that has not gone live has an empty LIVE: the Control Tower
shows a "Getting started" list and "0 operations files in motion". Tour the screens in TEST (the shot's
`env: "sandbox"`), where the sample data gives every screen something to show.

### 4.2 · A scene

```js
module.exports = {
  id, file, meta: { title, artist },
  opening: { eyebrow, title, subtitle, english, left },   // the cards (§2)
  closing: { eyebrow, title, subtitle, english, left },
  async prepare({ log, out }) { /* branding, cast, sample data, a fresh invitation */ },
  chapters: [{ name: "Se connecter", en: "Signing in", shots: [
    { kind: "card", card: "opening", lines: [{ fr: "...", en: "..." }] },
    { kind: "desktop", as: "nadege", start: "/", env: "sandbox", setup, lines: [
      { fr: "Appuyez sur «Sign In».", en: "Press “Sign In”.", do: (s) => s.click("Sign In") },
    ] },
    { kind: "phone", start: "/login", label: { eyebrow, title, subtitle }, lines },
  ] }],
};
```

A shot can also carry `authenticator: true` (a built-in reader in the browser, and `s.touch()`, §6.13), `still: true`
(reduced motion, for a page whose photograph drifts), `env: "sandbox"` (starts in TEST), `setup(s)` (after the sign-in) and
`ground()` (BEFORE the sign-in: what the database must hold for the sign-in itself to work).

A line is `{ fr, en, do?, before?, after?, hold?, speech? }`. `fr` is spoken (and is the French transcript),
`en` is the subtitle, `speech` overrides what the voice reads. A line's `do` starts as its narration
starts; the next line waits for both. `before` runs first and `after` once the line is said. A shot with
no `as` is filmed signed out, a sign-in or an invitation shown on camera; `as` signs the person in off
camera first. The hands (`s`): `click(name or Locator)` (a button, link, tab, menu item or option by its
exact name, in any case), `hover`, `type(label, text)`, `key("Control+K")`, `scroll(dy)`, `go(path)`,
`wait(seconds)`, `settle()`, `clearOffers()`, `touch()` and `s.page` for anything else. `helpers.js` has the
finders (`button`, `link`, `dialog`, `heading`), `soft` (glide there if it shows within a few seconds, so
a line that only points never costs a take), `tour` and `mailPage` (the invitation as the product wrote it).

### 4.3 · The commands

```bash
export PRAXIS_CHROMIUM=/opt/pw-browsers/chromium VIDEO_PYTHON=~/.video-venv/bin/python VIDEO_OUT=/tmp/video/<scene>
node scripts/video/make.js <scene> script      # read it: French and English, with a word count
node scripts/video/make.js <scene> narrate     # cached by text: only changed lines are spoken again
node scripts/video/make.js <scene> film        # or --only=c03s01,c04s02 to refilm some shots
node scripts/video/make.js <scene> assemble    # the MP4 and its two .srt files in VIDEO_OUT
```

Shots are named `cCCsSS` (chapter, shot). **Look at every shot before assembling**: a contact sheet of the
MP4 (`ffmpeg -i x.mp4 -vf "fps=1/4,scale=480:270,tile=4x4" sheet%02d.jpg`) shows it in a few images. Check
the loudness (`-af ebur128`, about -16 LUFS) and the chapters (`ffprobe -show_chapters`).

## 5 · Delivering

The MP4 and its two `.srt` files go to the training-videos folder the owner names, shared as anyone with
the link can view, named `Praxis-LS-<NN>-<Topic>-FR-EN.mp4`. A chat upload is capped, and the Drive
connector a session holds takes files of 10 MB at most: a video of this length is about 40 MB, so it is
sent as a file in the chat and uploaded by a person. Add the link to the table at the top of this file.

## 6 · Pitfalls already met

1. **The server serves the app only if `client/dist` exists when it starts.** Started before the build, it
   answers `/` with a JSON 404. Build, then start (or restart) the API.
2. **No service worker while filming.** Its "Ready to work offline" toast is not what a person sees on a
   day-to-day visit; the context blocks it (`serviceWorkers: "block"`).
3. **Things open by themselves over a first screen**: the "Allow location for clocking in" card, the
   "Don't miss an approval" alerts nudge. `clearOffers()` answers **Not Now** and **Dismiss** off camera,
   as a person would before a demonstration; acknowledging or clocking in is theirs to do, never filming's.
4. **Labels are set in capitals by CSS.** The screen reads SIGN IN, the page holds "Sign in": match names
   exactly but case-insensitively, and say them as the screen spells them in the narration.
5. **The sign-in window opens from a hero.** A fresh browser lands on the home page; **Enter Workspace**
   opens the window. A browser the product knows greets its person ("Welcome back, Nadège") and offers Quick
   PIN: every shot opens a fresh browser, so the first-time page is what is filmed.
6. **An invitation link is single use and there is one live link at a time.** `ground.invite(key, out,
   { reset: true })` puts a colleague who already chose a password back to "invited" and issues a new link;
   a scene's invitation shot calls it in its `setup`, so a retake meets what a new colleague meets. The
   message is captured from the mail service, never sent (there is no mail server, and none is wanted).
7. **A password is checked, not signed in with.** `ground.ready()` compares the filming password with the
   hash and sets it if it differs; signing in to check would make a new device.
8. **Chromium's screencast ignores the device scale**: frames come at CSS size and the text is soft once
   scaled up. `film.js` takes full-resolution captures back to back instead (about 19 a second).
9. **Python 3.13 cannot build spaCy**: use 3.12. **French needs `espeak-ng`.**
10. **Kokoro has one French voice and no male one.** Piper has several (tom, gilles, upmc, siwis, mls); the
    owner chose Kokoro's woman for the first video, so every video keeps her.
11. **An unseeded TEST is as empty as LIVE.** `prepare` loads the sample data once; `seed-sandbox.js`
    needs the catalogue seeds, which provisioning runs.
12. **A probe that stalls.** A Playwright click on a name that matches nothing waits its full timeout: probes
    set `page.setDefaultTimeout(6000)`, and a probe that signs in as someone who has no password yet (an
    invited colleague) stays on the sign-in page and every later click times out.

13. **A passkey on camera.** Chromium's virtual authenticator answers at once, so the screen would flash "Waiting for
    your device" for no time. `film.js` holds each `navigator.credentials` call until `s.touch()` and then lets the
    reader answer, so the viewer sees the wait, then the finger (`automaticPresenceSimulation: false` does not help:
    enabling it later does not release a request already waiting). Chrome allows one built-in reader per browser, and
    the app asks the browser whether there is one when a page opens, so the reader is added before anything loads
    (`authenticator: true` on the shot). Password-manager autofill (conditional mediation) is not held.
14. **A reader changes the sign-in window.** It shows "Sign in with a passkey" under the button, so a finder for the
    last button named "Sign in" presses the wrong one: match the exact name. After a password sign-in on such a
    browser the window offers "One touch next time" before the app opens; `signIn` answers **Not now**. The button
    carries the device's own name, from the user agent: **Set up Windows Hello** on filming's Windows browser.
15. **The Quick PIN signs in on its fourth digit.** There is no button to press. Type three digits with one line and
    the fourth with the next, so the sign-in lands with the words that say so. The lock screen's PIN works the same.
16. **A code is checked against the current thirty-second step only.** One typed over several seconds can cross the
    change and be refused. `ground.freshCode(secret)` waits for a step with time left. The key under "No camera?" is
    the secret, so the video types a real code.
17. **A colleague with two-step on cannot be signed in off camera.** `setup` runs after the sign-in; a shot's `ground`
    runs before it (`resetSecurity`). Likewise the lock screen offers the PIN beside the passkey only if the account
    HAD one at sign-in, so a chapter that needs it gives it first.
18. **Chapters must not depend on each other.** Each starts from its own ground (`resetSecurity(emails, ["pin"])`,
    `setQuickPin`, `enableAuthenticator`), so `--only=c06s01` meets what a full run meets.
19. **Say a screen while it is on screen.** The lock screen's other buttons were narrated after the unlock, and the
    phone's "Lost your phone?" after the sign-in. Review every take on a timeline (a frame every few seconds), not on
    one frame per line: `ffmpeg` tiles are in §4.3.
20. **A card title is one line.** A long one ran off the picture ("Se connecter en toute sécur"); `style.titleSize`
    now shrinks it to fit.

## 7 · Bugs found while filming

Each is fixed on the video's branch, in the screen's own code, and listed here.

| Date | Screen | What filming showed | Fix |
| --- | --- | --- | --- |
| 15/11/2026 | Set Password (the emailed invitation and reset link) | The page stated the password policy in a sentence ("a mix of cases, a number and a symbol") but its list ticked only the length and "Passwords match", the button gated on the length alone, and each tick sat on its own line above its words | Fixed the same day: the page uses the shared policy (`lib/password-policy.ts`, as the admin forms do), each rule is one flex line, the button waits for every rule; `reset-password-page.test.tsx` |
| 15/11/2026 | Set Password, Password Updated | The page opened on a flat grey screen: the tenant's login photograph is only painted by the home page, and this page opens from a link, often on a browser that has never seen the tenant | Fixed the same day: the scrim wears the tenant's login photograph (`--login-photo`, `index.css`); plain when the tenant has none or the read fails |
| 15/11/2026 | Home page, TEST banner, Reset Your Password | Em dashes in copy a tenant reads: the sign-in sentence ("end to end — from the floor"), the TEST banner ("TEST MODE — you're viewing sandbox data"), English and French, and the reset confirmation ("30 minutes — check your spam folder") | Fixed the same day: a comma, a colon and a full stop (`i18n-dict.ts`, `landing-page.tsx`, `sign-in-panel.tsx`). About 1,100 others remain in the dash baseline (`npm run check:dashes`) |
| 15/11/2026 | The invitation email and the password-reset email | A new colleague's first message from the product carried em dashes ("Choose a password to activate it — this link expires…", "Not expecting this? Tell your administrator — the account cannot…"), in the HTML and in the plain-text part, as did the reset email | Fixed the same day: full stops (`app_user.service.js`) |
| 15/11/2026 | `scripts/tenant/seed-sandbox.sql` | The TEST seed stopped with "financial dictionary not present": it looked up `#R002` (Documentation Fee), which the catalogue no longer has | Fixed the same day: the item is `#D028` |
| 15/11/2026 | My Security (the account menu's "My security") | A finance officer or an operations lead was shown "Security & Access is not part of your access" on the one page that is theirs, where every employee sets a passkey, a Quick PIN and the authenticator: the page is gated by the hub's module | Fixed the same day: `OWN_ACCOUNT` in `route-access.ts` opens it to anyone signed in, the hub and the other Security screens stay gated; `route-access.test.ts` |
| 15/11/2026 | My Security, the passkey card | A code comment printed under the card's heading: `/* @prose:keep ... */` sat between two elements outside braces, so React drew it as text | Fixed the same day: braces; `src/test/no-printed-comments.test.ts` keeps a bare comment between two elements from reaching a screen |
| 15/11/2026 | The activity feed (Control Tower, My Workspace) | "You did registered on a passkey just now": the last segment of the action is not a verb the humaniser knows, so it fell to its generic sentence; the same for a Quick PIN being set, changed or turned off | Fixed the same day: sentences for the passkey and Quick PIN events (`audit-humanize.ts`, marked sensitive); `audit-humanize.test.ts` |
| 15/11/2026 | My Security, after setting a passkey | "Done. your fingerprint now signs you in on this device." began in lower case when the device is named by what it reads ("your fingerprint", "your passkey") | Fixed the same day: the first letter is capitalised |
| 15/11/2026 | The passkey offer, the lock screen, the weak-PIN messages | Em dashes in what a tenant reads: "one touch — no password, no PIN", "Your work is safe behind the lock — nothing ...", "A PIN can't be a straight run ... — pick something less guessable", and two passkey messages | Fixed the same day: full stops, commas and a colon (`sign-in-panel.tsx`, `lock-screen.tsx`, `packages/shared/rules/quick-pin.js`) |

## 8 · Where the work stands

**15/11/2026 · JBS Praxis (with Claude). The introduction, part 1.** Decided by JBS Praxis (eight questions
asked first): filmed on a throwaway local copy, never a deployed site; invented staff (an Operations Manager,
an Import Operations Lead, an Export Operations Lead, a Finance Manager and a Managing Director); the real
Smart LS branding (its logo, login photograph, palette and fonts, read from what the tenant publishes);
French narration with English subtitles and the application kept in English, so every name is spoken in
English; TEST described as it is (a practice copy that never touches LIVE and that Praxis LS can reset),
with a per-tenant "TEST off unless Praxis LS turns it on until a date" switch left as the next piece of work;
two parts, part 1 first.

Part 1, Premiers pas (`p1-first-steps.js`): Welcome; the invitation (the email, Set my password, choosing
one); signing in (Enter Workspace, Email, Password, Sign In); forgotten password; LIVE and TEST (the switch
and its confirmation, the orange banner); the Control Tower; the desktop workspace (top bar, search, the
account menu, the ribbon's six families and their tabs, the left column, Help); on the phone (Serge Ndzana's
sign-in, the bottom bar, the LIVE button); signing out; Wrapping Up.

**15/11/2026 · The introduction, part 2** (`p2-secure-sign-in.js`), filmed on the same copy the same day. Nadège
Tchouameni signs in and is offered a passkey (**One touch next time**, **Set up Windows Hello**, the wait, the finger);
My Security (the passkey card, **Your passkeys**, **Remove**, the Quick PIN and authenticator cards); the Quick PIN
(a weak one refused, a good one set with **Set up Quick PIN**, then used on her returning device, which signs her in on the
fourth digit); the lock screen (**Lock screen**, the blur, the passkey waiting, **Use PIN** and **Use Password**, the touch).
Serge Ndzana turns on two-step verification (**Authenticator App**, **Set Up**, the square, **No camera?**, a real code,
the ten recovery codes, **Done** and **Yes, Saved**, **Ask for a Code**) and signs in on his phone with a code (**Two-step
verification**, **Lost your phone?**). Wrap-up: keep the password, add one quick way in, the passkey being the most convenient.

Part 2: 53 lines of narration (869 French words), 7 filmed shots and two cards, 5 minutes 46 seconds, 1920 × 1080,
-16.3 LUFS, 9 chapters, 14 MB. Narration took about 5 minutes on a CPU, filming about 8, assembly about 4. Five bugs
fixed on the branch (§7), one of them (My Security refused to people without the Security module) a real defect in the
product. The tooling learnt §6.13 to §6.20: a built-in reader and `touch()`, the `ground` hook, a code with time left.

Made on one development database in one sitting: 82 lines of narration (7.1 minutes of speech), 8 filmed
shots and two cards, 8 minutes 19 seconds, 1920 × 1080, -16.3 LUFS, 10 chapters, 22 MB. Narration takes
about 5 minutes on a CPU, filming about 10, assembly about 4. Four bugs fixed on the branch (§7). The
tooling learnt §6.1 to §6.12.

Sample data on screen. The Control Tower and Fulfil screens show the sandbox seed's clients and files
(`scripts/tenant/seed-sandbox.sql`), whose names are those of well-known companies in Cameroon. The seed is
fictional data, the video says so, and a tenant that prefers invented company names changes the seed once.

- [x] Plan, build the tooling, write, film and check part 1.
- [x] Part 2 (safer sign-in), the same day.
- [ ] What follows is JBS Praxis's to choose (the day-to-day modules). The closing card says "le travail de tous les jours"
      and promises no particular video.
- [ ] A per-tenant switch that turns TEST off, and on for a period (the owner's follow-up).
