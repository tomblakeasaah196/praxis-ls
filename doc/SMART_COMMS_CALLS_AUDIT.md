# Smart Comms Calls — integration audit and fix plan

**Date:** 2026-09-24 · **Scope:** the 1:1 voice-call integration merged in PRs
#454–#459 (commits `0231e59` → `bd77700`): about 9,000 lines of product code
across the backend, worker jobs, realtime layer, migrations, the tenant client,
the service worker and the platform console. **Method:** I read every file in
that diff and traced each user-visible symptom to the code path that causes it.
Every finding cites `file:line`. Nothing here was run against production data;
§0 gives the queries that confirm the root cause on a live tenant.

**Verdict.** The server-side state machine (guarded transitions, the
one-active-call partial indexes) and the database schema are sound and worth
keeping. The **record pipeline's scheduling and notifications, the client call
engine, the recorder, the call screen and the TURN deployment** are broken
badly enough that they should be rebuilt rather than patched. Section 4 says
what to keep, rebuild and remove. A targeted rebuild of those parts costs less
than starting from scratch, because the parts worth keeping are the hard ones
to get right.

| Severity | Count | Meaning |
| --- | --- | --- |
| CRITICAL | 7 | Wrong for every user or every call, or loses/corrupts data. Fix first. |
| HIGH | 31 | Security hole, cross-tenant scale failure, or a feature that does not work in real use. |
| MEDIUM | 36 | Real defect with a narrower blast radius. |
| LOW | 9 | Hygiene, misleading docs, minor leaks. |

---

## 0. Stop the bleeding (today, before any code change)

The nightly notifications come from the `comms-call-record-sweep` job (§1). It
is registered again every time the worker boots, so it **cannot be switched off
from configuration**. Turning the `call_recording` feature off does not stop it
either: the pipeline never checks that flag (A5). Until the Phase 1 hotfix
ships, park the affected calls so the sweep's two queries no longer select
them.

**1. Confirm the pattern** (run in the tenant database, live schema):

```sql
-- When do the summary notifications land? Expect a spike at 00:00–00:59 UTC.
SELECT date_trunc('hour', created_at) AS hour_utc, count(*)
  FROM notification
 WHERE event_type_key = 'comms.call_summary_ready'
 GROUP BY 1 ORDER BY 1 DESC LIMIT 72;

-- How many times has each call been re-announced?
SELECT entity_ref, count(*) AS times, min(created_at), max(created_at)
  FROM notification
 WHERE event_type_key = 'comms.call_summary_ready'
 GROUP BY entity_ref ORDER BY times DESC LIMIT 20;

-- The calls that feed the loop.
SELECT c.call_id, c.status, c.duration_seconds, c.transcription_state,
       c.transcription_attempts, left(c.transcription_error, 120) AS error,
       s.draft_status
  FROM comms_call c LEFT JOIN comms_call_summary s USING (call_id)
 WHERE c.status IN ('ENDED','FAILED')
   AND c.transcription_state IS DISTINCT FROM 'CERTIFIED'
 ORDER BY c.started_at DESC LIMIT 50;
```

**2. Park them.** Run this per tenant database, in the live schema and, where it
exists, the sandbox schema. Take a backup first. The marker makes it
reversible:

```sql
BEGIN;
-- Out of listFailedTranscriptions (attempts < 20).
UPDATE comms_call
   SET transcription_attempts = 20,
       transcription_error = coalesce(transcription_error, '') || ' [parked 2026-09-24 audit]'
 WHERE transcription_state = 'TRANSCRIPTION_FAILED';
-- Out of listUntranscribedEndedCalls (NULL / PENDING / stale PROCESSING).
UPDATE comms_call
   SET transcription_state = 'TRANSCRIPTION_FAILED',
       transcription_attempts = 20,
       transcription_error = coalesce(transcription_error, '') || ' [parked 2026-09-24 audit]'
 WHERE status IN ('ENDED','FAILED')
   AND (transcription_state IS NULL OR transcription_state IN ('PENDING','PROCESSING'));
COMMIT;
```

New calls still enter the pipeline when they end. This stops the backlog, not
the defect. If calling should be off until Phase 1 ships, switch the `calls`
feature off for the tenant in the platform console. That hides nothing already
queued, so run the SQL as well.

---

## 1. Root cause: the 01:00 "review and send the summary of your call" notifications and the "fake calls"

Seven defects combine. Each is listed in §2 with its fix; this is the chain:

1. **The daily sweep runs at 00:00 UTC, which is 01:00 in Douala/Lagos/Kinshasa.**
   `workers.js:366-367` registers it with `repeat: { every: 86_400_000 }`.
   BullMQ 5.79.3 (the locked version) computes the next run as
   `floor(now / every) * every + every` (`dist/cjs/classes/repeat.js:184`), so
   the run is aligned to the Unix epoch: midnight UTC. (A1)
2. **Most summaries are first created by that sweep, not after the call.**
   The only trigger after hang-up is one job delayed 20 s
   (`smartcomm.call.service.js:393-397`). The comments say uploads re-trigger
   the job when the last part lands, but nothing calls `startPipeline` from the
   upload path (only `call.service.js:394` and the sweep). If either side's
   audio has not arrived after 20 s, the job returns `waiting` and nothing runs
   again until the nightly sweep. The summary, and its push, are then created
   at 01:00. (A2)
3. **Every call longer than about 2 minutes fails transcription.** The
   recorder cuts one continuous `MediaRecorder` stream into 2-minute "parts"
   (`call-recorder.ts:181,214`). Only the first chunk of a WebM/MP4 stream
   carries the container header, so parts 2..N cannot be decoded. The provider
   rejects them, the whole side falls back, and the call goes to
   `TRANSCRIPTION_FAILED`. (A3)
4. **Failed calls are reprocessed and re-announced every night, 20 times.**
   `listFailedTranscriptions` retries until `transcription_attempts < 20`
   (`smartcomm.call.repo.js:315-319`). Each run re-drafts the summary and calls
   `notifySummaryReady` (`smartcomm.call.pipeline.service.js:742-779`), which
   sends an in-app notification and a web push. It also raises an ops alert
   and makes a billed LLM call. (A4)
5. **Calls with no audio at all go through the same path.** This covers
   recording switched off, calls from before PR-2, zero-second calls, and calls
   where the recorder never armed. The LLM is prompted with
   `"(no words were captured for this call)"` (`pipeline.service.js:295`) and
   its output is presented as your call's summary. (A5)
6. **You cannot open the draft, so you cannot stop it.** The review panel only
   opens on the `call:summary_ready` socket event (`call-session.ts:680`). That
   event is published from the worker process, where the socket server does
   not exist, so `publishToUser` does nothing (`realtime/index.js:438-439`).
   Tapping the notification opens `/comms?call=<id>`
   (`pipeline.service.js:921`). The client reads that as an incoming-call link
   (`ring-surface.ts:176`) and shows **"That call has already ended — Call
   again"** (`call-session.ts:819`, `comms-live.tsx:206-229`). You are offered
   a redial for a call you did not miss, and because the draft is never sent or
   discarded, step 4 continues. (A6)
7. **Other sources of "calls I never placed":**
   - Ring pushes are pinned (`requireInteraction`) and nothing clears them when
     the app was closed. (A7)
   - The Answer/Decline buttons on the notification both just open the app. (A8)
   - Sandbox (training) calls ring on live devices. (A9)
   - A call whose tab was closed stays open and is recorded as a **30-minute
     call**. The hang-up-on-close request goes to a URL that does not exist,
     and the liveness sweep crashes. (A10, B1)

---

## 2. Findings

Each finding lists **Where / What / Fix**. IDs are grouped by area:
A = notifications and phantom calls, B = backend correctness,
C = security, D = multi-tenant scalability, E = client engine,
F = call UI, G = privacy, H = tests and docs.

### A. The notification loop and phantom calls

**A1 · CRITICAL · The daily sweep fires at 01:00 West Africa Time**
- Where: `src/jobs/workers.js:366-367`
- What: `every: 24h` is aligned to the epoch by BullMQ, so it runs at 00:00 UTC.
  Every tenant's reprocess, LLM calls and pushes land at 01:00 WAT. The same
  instant is also a fleet-wide load spike (D2).
- Fix: use a cron `pattern` in the tenant's timezone during working hours, or
  run hourly in small batches. Never notify from a sweep (A4).

**A2 · CRITICAL · No trigger after the last upload, so summaries are created at night and transcripts are silently cut short**
- Where: `smartcomm.call.service.js:385-397` (single delayed enqueue);
  `smartcomm.call.pipeline.service.js:351-400` (`registerPart` never enqueues);
  `pipeline.service.js:649-654`.
- What: the pipeline runs once, 20 s after hang-up.
  - If one side has not uploaded yet, it returns `waiting` and nothing re-runs
    it until the nightly sweep.
  - If both sides have some parts but a side's last part has not arrived,
    `missing` is empty and the pipeline **certifies a transcript that lacks the
    end of the call**. `part_count` is a running index, not a declared total,
    so the gap cannot be detected.
- Fix: the client sends a final "side complete" request (`POST
  /calls/:id/recording/complete {parts: N}`). The server enqueues the job when
  both sides are complete or at a hard deadline. Certify only when every
  declared part is present.

**A3 · CRITICAL · Parts after the first are undecodable, so every call over about 2 minutes fails**
- Where: `client/src/features/comms/call/call-recorder.ts:181`
  (`rec.start(CHUNK_MS)`), `:214` (`groupChunks` of later chunks).
- What: with a timeslice, only the first `dataavailable` blob has the WebM
  EBML/Tracks header (fragmented MP4 on Safari has the same property). Part 2
  and later are headerless clusters that Whisper/ffmpeg cannot decode, so the
  side falls back and the call becomes `TRANSCRIPTION_FAILED`, feeding A4.
- Fix: stop and restart the `MediaRecorder` at each part boundary so every part
  is a complete file, or upload one continuous file with resumable chunked
  upload. Add a server-side probe of the container header before accepting a
  part.

**A4 · CRITICAL · The same call is re-announced every night for up to 20 nights**
- Where: `smartcomm.call.repo.js:315-319`; `pipeline.service.js:742-779,908-928`.
- What: every reprocess of a `TRANSCRIPTION_FAILED` call with a
  `PENDING_REVIEW` draft upserts the draft and pushes "Call summary ready".
  Each run also raises a `comms.transcription_failed` ops alert
  (`pipeline.service.js:725`) and makes a billed LLM call.
- Fix: notify once, when a draft is first created, and again only if a sent
  summary gains an update. Suppress notifications from sweep runs. Record the
  notification in a `notified_at` column and check it before sending.

**A5 · HIGH · Calls with no audio are summarised by the LLM anyway**
- Where: `smartcomm.call.repo.js:342-359` (`status IN ('ENDED','FAILED')`,
  state NULL); `pipeline.service.js:599-790` (no `recordingEnabled` check);
  `:295` (empty transcript placeholder).
- What: this covers tenants with recording off, calls from before PR-2,
  zero-length calls, and devices where the recorder never armed. The result is
  a `TRANSCRIPTION_FAILED` state, an ops alert, a "summary" drafted from
  nothing, and a push.
- Fix: process a call only if recording is on and at least one part or
  live-log segment exists. Otherwise set a terminal `NO_RECORDING` state and
  send nothing.

**A6 · CRITICAL · The draft cannot be opened, and the notification offers a redial instead**
- Where: `client/src/features/comms/call/call-session.ts:680` (only opener);
  `src/realtime/index.js:438-439` (no-op in the worker);
  `pipeline.service.js:921` (`/comms?call=`);
  `ring-surface.ts:172-181` (any `?call=` is treated as a ring);
  `call-session.ts:814-822`; `comms-live.tsx:206-229`.
- What: users are pushed to review a draft that no screen can open. The link
  shows "That call has already ended — Call again", and pressing it places a
  real call. Because the draft is never sent or discarded, A4 never stops.
- Fix: give summaries their own route (`/comms/calls/:id/summary`) and a
  "Calls" list with pending drafts. Use a distinct deep-link parameter for
  rings (`?ring=`). Publish worker-side socket events through
  `@socket.io/redis-emitter` (D-section).

**A7 · HIGH · Ring notifications stay on the lock screen after the call ends**
- Where: `smartcomm.call.service.js:698-730` (`requireInteraction: true`);
  `client/public/push-handler.js:68-124` (ignores `data.expires_at`).
- What: when the app was closed, nothing closes the push after the call
  times out or is answered elsewhere. "Incoming call from X" with Answer/Decline
  stays pinned for hours, and tapping it later produces the redial banner.
- Fix: on every terminal transition, send a data-only "call-ended" push that
  closes tag `call:<id>` in the service worker. In the push handler, schedule a
  close at `expires_at`.

**A8 · HIGH · The notification's Answer/Decline buttons do nothing different**
- Where: `client/public/push-handler.js:127-150`;
  `ring-surface.ts:93` (`ringUrl` without `act`).
- What: `notificationclick` handles only `dismiss`. Accept and Decline both
  navigate to the same URL, so Decline opens the app and the ring continues.
  The `act=accept|decline` handling in `call-session.ts:771-812` is
  unreachable.
- Fix: map `event.action` to `?ring=<id>&act=…`. For Decline, POST the decline
  from the service worker using a short-lived per-call action token, so the app
  does not need to open.

**A9 · HIGH · Sandbox (training) calls ring and notify on live devices**
- Where: `src/realtime/index.js:45` (`userRoom = t:<slug>:u:<uid>`, no env).
- What: every `call:*` event from the sandbox schema reaches the user's live
  sockets. Accepting then returns 404 on the live API, which looks like a ghost
  call.
- Fix: include the env in the user room (`t:<slug>:<env>:u:<uid>`) and join
  the socket's own env room.

**A10 · HIGH · A closed tab leaves a phantom 30-minute call**
- Where: `client/src/features/comms/call/call-session.ts:475` posts to
  `/api/tenant/comms/calls/:id/hangup`, but the route is
  `/api/tenant/smartcomm/calls/:id/hangup`, so it always 404s. The liveness
  sweep is broken too (B1, B2).
- What: the call stays `IN_CALL` until the 30-minute cap. History records a
  30:00 call (`durationSeconds` clamps to 1800), both users show as busy for 30
  minutes, and the call enters the summary pipeline.
- Fix: correct the URL, and have the e2e test exercise the real path (H1).

**A11 · MEDIUM · The notification does not say which call, and is English-only**
- Where: `pipeline.service.js:915-923`.
- What: "Call summary ready — Review and send the summary of your call." has
  no name, date or duration, so it is unrecognisable, especially when repeated.
  It is server-side English for French users, and it is sent at any hour (no
  quiet hours).
- Fix: include the counterpart and time. Localise via the service worker the
  way ring strings are. Respect quiet hours.

### B. Backend correctness (state machine and record pipeline)

**B1 · CRITICAL · The liveness sweep violates the database CHECK and crashes**
- Where: `smartcomm.call.service.js:552` (`reason: "disconnected"`) against
  `migrations/tenant/14000_comms_calls.sql:60-61`, which allows only hangup,
  declined, cancelled, no_answer, busy, max_duration and ice_failed.
- What: the UPDATE fails with 23514, the sweep job throws every 15 s for that
  tenant, and the abandoned call is never ended. On the pooled sandbox path the
  whole sweep runs in one transaction (`registry.service.js:480-490`), so the
  failure also rolls back that tick's NO_ANSWER and max-duration transitions,
  and sandbox rings never time out.
- Fix: map it to an allowed reason, or widen the vocabulary in a migration
  that follows the constraint-ordering rule (`migration-constraint-ordering.test.js`).
  Add a test that runs `sweepLiveness` against a real schema.

**B2 · HIGH · The liveness rule ends calls when only ONE device is gone**
- Where: `smartcomm.call.service.js:546` (`Math.min`).
- What: the documented rule is "both gone for 60 s". With `min`, one device
  gone 60 s plus a momentary blip on the other ends the call. Peer-to-peer
  audio keeps working without the socket, so this cuts healthy calls.
- Fix: use `Math.max`.

**B3 · HIGH · The online/offline registry never expires**
- Where: `src/realtime/index.js:350-386`; `call.service.js:513-560`.
- What: SET members are removed only on a clean disconnect. A crashed or
  redeployed replica leaves ghost "online" users forever, so liveness never
  fires for them. Offline ZSET entries are never cleared for calls that end
  normally. Both keys grow without bound.
- Fix: per-socket keys with a short TTL refreshed by heartbeat. Check liveness
  with `EXISTS`/`SCAN` per user. Delete the call's ZSET entries on every
  terminal transition.

**B4 · CRITICAL · Reprocessing crashes forever once one side is certified, and re-bills Groq nightly**
- Where: `smartcomm.call.repo.js:434-464` (retires only `browser-live` rows);
  `:350-352` (stale `PROCESSING` is selected with no attempts cap);
  `pipeline.service.js:656-657`.
- What: when the certified side is re-inserted it hits
  `uq_comms_call_transcript_current` (23505). The job fails after setting
  `PROCESSING`, and the stale-`PROCESSING` branch picks it up again every night
  with no cap. Each night the certified side is transcribed and billed again
  (twice, since the job has 2 attempts), and the call shows "Transcribing…"
  forever.
- Fix: skip sides whose current rows are already certified. Retire any
  current row being replaced. Cap attempts on the `PROCESSING` branch too.

**B5 · HIGH · Head-of-line starvation in the reprocess**
- Where: `smartcomm.call.repo.js:342-359` (`ORDER BY ended_at ASC LIMIT 25`);
  `pipeline.service.js:126-133,607`.
- What: FAILED calls that never connected match the query, but `processCall`
  skips them without changing their state. They take the oldest 25 slots every
  night. Once a tenant has 25 of them, which is common without TURN, no other
  call is ever retried. B4's stuck rows add to this.
- Fix: exclude ineligible calls in SQL, and mark every skip with a terminal
  state.

**B6 · HIGH · A summary sent or discarded during processing comes back as a draft**
- Where: `pipeline.service.js:613` (read) then `:764-771` (upsert minutes
  later); `smartcomm.call.repo.js:503-510` (`draft_status = 'PENDING_REVIEW'`
  on conflict).
- What: a SENT summary returns to `PENDING_REVIEW` with `sent_message_id`
  still set, so it can be sent again. A DISCARDED one is revived and pushed
  again.
- Fix: `ON CONFLICT … DO UPDATE … WHERE comms_call_summary.draft_status =
  'PENDING_REVIEW'`, plus a row lock (`SELECT … FOR UPDATE`) or an optimistic
  version column.

**B7 · HIGH · Double-posting a summary, and the claimed atomic write does not exist**
- Where: `pipeline.service.js:1080-1136`; `smartcomm.call.repo.js:558-567`
  (no status guard); request handlers run in autocommit
  (`middleware/tenant-context.js:120-157`).
- What: a double tap or two tabs post two messages. A failure after
  `postMessage` leaves the draft `PENDING_REVIEW` and sendable again. Migration
  14010 says "NO code path posts without this write happening in the same
  transaction", which is false.
- Fix: one transaction. Claim the draft first with
  `UPDATE … SET draft_status='SENDING' WHERE draft_status='PENDING_REVIEW'
  RETURNING`, then post, then mark it SENT.

**B8 · MEDIUM · Terminal transitions do not record who acted**
- Where: `smartcomm.call.service.js:356-369` (`actorUserId: null`).
- Fix: pass the actor through `endCall` for hang-up, decline and fail; use
  `null` only for the sweep.

**B9 · MEDIUM · The client chooses the recorded end reason**
- Where: `smartcomm.validator.js` (`callHangup` enum includes `max_duration`,
  `no_answer` and `busy`); `smartcomm.controller.js` (`hangupCall` passes it
  through).
- What: an IN_CALL→ENDED transition can be labelled `max_duration` after 10
  seconds, which pollutes the metrics. The server is not authoritative here,
  despite the file's own claim.
- Fix: the server derives the reason and ignores the body.

**B10 · MEDIUM · Dead branch in the duration calculation**
- Where: `smartcomm.call.service.js:349`: `status === "IN_CALL"` is never
  true there, so the `max_duration` branch of `durationSeconds` never runs.
- Fix: pass `reason`.

**B11 · MEDIUM · The validator allows 60-minute parts but the column allows 120 s, after storage is already written**
- Where: `smartcomm.validator.js` (`duration_ms` max 3,600,000);
  `14010:94` (CHECK ≤120); `pipeline.service.js:376-388` (storage `put`
  before the insert).
- What: a slightly long part, for example from a throttled background tab,
  fails after its bytes are written. The object is orphaned and the part is
  lost.
- Fix: cap at 125,000 ms in the validator, and write the row before promoting
  the object.

**B12 · MEDIUM · Re-uploads orphan audio, so it is never purged (retention violation)**
- Where: `pipeline.service.js:376` (a new random key per upload);
  `smartcomm.call.repo.js:224-231` (overwrites `vault_ref`).
- What: the previous object stays in storage forever, beyond the tenant's
  retention window.
- Fix: use a deterministic key per (call, side, part), or delete the old
  object on replace.

**B13 · MEDIUM · Uploads accepted for any call at any time**
- Where: `pipeline.service.js:351-400,445-454`.
- What: uploads are accepted for NO_ANSWER, DECLINED, CANCELLED and months-old
  calls. There is no per-call byte quota, `part_index` is not checked against
  `part_count`, the live log accepts unbounded `seq` values, and
  `live_segments` sent with the audio are ignored by the controller
  (`smartcomm.controller.js` `uploadCallRecording`).
- Fix: accept uploads only while the call is IN_CALL or recently ENDED
  (15-minute window) and it connected. Add a per-call byte and segment cap.

**B14 · MEDIUM · Two copies of `recordingEnabled` with opposite failure behaviour**
- Where: `smartcomm.call.service.js:61-72` fails closed;
  `pipeline.service.js:313-319` throws.
- Fix: one helper.

### C. Security vulnerabilities

**C1 · HIGH · The TURN relay is an SSRF path into the host and Docker networks**
- Where: `docker-compose.yml:161-179` (`network_mode: host`, no
  `--denied-peer-ip`, no quotas).
- What: any credential holder can ask coturn to relay to RFC1918, Docker
  bridge and link-local (cloud metadata) addresses. That reaches Postgres and
  Redis on the host network. This is a well-known TURN misconfiguration.
- Fix: add `--denied-peer-ip` for 0.0.0.0/8, 10/8, 100.64/10, 127/8,
  169.254/16, 172.16/12, 192.168/16 and ::1/fc00::/7; keep
  `--no-loopback-peers` and `--no-multicast-peers`; add `--user-quota`,
  `--total-quota` and `--max-bps`; pin the image version; firewall the relay
  port range.

**C2 · HIGH · Anyone can mint TURN credentials, for any past call, without limit**
- Where: `smartcomm.turn.service.js:43-62` (username = expiry only);
  `smartcomm.call.service.js:756-761` (`turnFor` accepts any call the user ever
  joined, whatever its status); no rate limit; one secret for every tenant.
- What: any employee can generate unlimited 31-minute relay credentials that
  anyone can use. Nothing ties a credential to a call, user or tenant, so
  there is no attribution or targeted revocation. The comments at
  `call.service.js:753-755` claim the credential is user-scoped; it is not.
- Fix: issue credentials only for RINGING or IN_CALL calls. Use
  `<expiry>:<opaque-call-token>` as the username so relay logs can be
  attributed. Rate-limit issuance, and keep TTL at the call's remaining time
  plus a margin.

**C3 · HIGH · TURN is probably not working at all, so calls fail on mobile CGNAT**
- Where: `docker-compose.yml:179` (`TURNSHAREKEY`); `.env.example`
  (`TURN_HOST=` empty by default); the `turn` compose profile is opt-in.
- What: coturn does not read a `TURNSHAREKEY` variable. `--use-auth-secret`
  needs `--static-auth-secret`, so minted credentials are rejected. There is
  also no `--realm`, no `--external-ip` (needed behind cloud NAT) and no
  TLS/443 listener. Most deployments are STUN-only, which cannot connect the
  carrier-grade NAT mobile networks the corridor uses, and those failures then
  feed B5.
- Fix: correct the coturn flags, add a `turns:` listener on 443/TLS, and add a
  deployment health check that allocates a relay with `turnutils_uclient`.

**C4 · HIGH · IDOR: any member can surface another pair's call summary in any channel**
- Where: `smartcomm.validator.js` (`attachment` accepts
  `attachment_kind:"CALL", call_id`); `smartcomm.service.js:122-131` (stored
  unchecked); `pipeline.service.js:1033-1049` (`cardsForCallIds` has no
  participant or status filter).
- What: posting an ordinary message with a CALL attachment pointing at someone
  else's call id resolves its summary, key points, follow-ups, participant
  names, duration and transcription errors. That includes unsent
  `PENDING_REVIEW` and `DISCARDED` drafts. Call ids appear in push payloads,
  URLs, audit logs and ops alerts.
- Fix: reject `CALL` attachments on the generic message route (only
  `sendSummary` may create one). When resolving cards, require
  `sent_message_id = message_id` and `draft_status = 'SENT'`.

**C5 · MEDIUM · The signalling relay works for dead calls, has no size or rate limits, and uses a DB connection per event**
- Where: `src/realtime/index.js:262-335` (`otherParticipant` has no status
  filter, `repo.js:127-134`).
- What: a past participant can push SDP offers into the other person's client
  at any time. Payloads are unvalidated and can be any size up to socket.io's
  1 MB default. Every ICE candidate opens a tenant DB connection, so a flood of
  events exhausts the tenant pool.
- Fix: relay only for RINGING or IN_CALL calls. Cache the participant pair per
  socket for the call's lifetime. Validate SDP (type, ≤ 64 KB), rate-limit
  per socket, and set `maxHttpBufferSize`.

**C6 · MEDIUM · Call bombing, and rings reaching deactivated employees**
- Where: `smartcomm.routes.js` (`POST /calls` has no throttle);
  `smartcomm.call.repo.js:149-159` (`directPartner` has no `status =
  'ACTIVE'` check).
- What: a dial/cancel loop rings and pushes a colleague every few seconds, and
  there is no block or do-not-disturb. A deactivated employee's registered
  phone still receives "Incoming call from X".
- Fix: per-caller and per-callee dial rate limits, a block/DND option,
  callee must be ACTIVE, and delete push subscriptions on deactivation.

**C7 · MEDIUM · Unbounded client text is sent to the LLM (cost and prompt injection)**
- Where: `smartcomm.validator.js` (`callLiveLog` 2,000 × 2,000 chars, repeatable
  with new `seq`); `pipeline.service.js:191-207,269-299`.
- What: a participant can force a fallback (upload unreadable audio) and feed
  megabytes of chosen text into the prompt. The tenant is billed for it and the
  text can steer the summary.
- Fix: cap total live-log characters per side (for example 60 k), delimit and
  label untrusted transcript text in the prompt, and cap tokens.

**C8 · MEDIUM · Regenerate is an unmetered LLM call inside the request**
- Where: `pipeline.service.js:1175-1230`; `smartcomm.routes.js`
  (`/summary/regenerate`).
- What: the request's DB lease is held during the LLM call. There is no rate
  limit, and no "language must differ" check despite the comment, so re-rolls
  are unlimited.
- Fix: enqueue the regeneration as a job, rate-limit it, and enforce the
  language change.

**C9 · MEDIUM · Presence writes have no server-side throttle**
- Where: `src/realtime/index.js:348-386`.
- What: every `comms:seen` event and every connect or disconnect writes
  `comms_user_presence`. One client can flood it.
- Fix: throttle per socket on the server; coalesce writes through Redis.

**C10 · MEDIUM · The AI assistant bypasses the recording kill switch**
- Where: `smartcomm.ai.js` reads `comms_call_transcript` and
  `comms_call_summary`, gated only on MOD-64 view.
- What: the HTTP routes also require `call_recording`; the AI path does not.
- Fix: check the feature flag in the manifest reads.

**C11 · LOW · Vendor error text leaks to users**
- Where: `transcription_error` is returned in cards and summaries
  (`pipeline.service.js:1037-1040,1009-1010`).
- Fix: map to a reason code.

**C12 · LOW · Google STUN is used by default, contrary to the template**
- Where: `smartcomm.turn.service.js:31`.
- What: every client's address is sent to Google. `.env.example` says an empty
  value means the STUN server is omitted; it is not.
- Fix: default to the tenant's own STUN/TURN.

**C13 · LOW · Peer-to-peer calls expose employees' IP addresses to each other**
- What: host and server-reflexive candidates reveal each participant's network
  location, and there is no relay-only option.
- Fix: offer a tenant setting for `iceTransportPolicy: "relay"`.

### D. Multi-tenant isolation and scalability

**D1 · HIGH · A 15-second fleet-wide sweep, run serially**
- Where: `src/jobs/workers.js:355-357`; `comms-call-sweep-scheduler.js`;
  `workers.js` (`comms-call-sweep` concurrency 1).
- What: every 15 s there is one job per tenant×env, each opening a tenant
  connection and running 2 queries plus Redis reads, including tenants that
  have never made a call. It runs 24/7. With concurrency 1, one slow tenant
  delays ring timeouts and the 30-minute cap for every other tenant. The
  scheduler also reads the platform DB every 15 s.
- Fix: per-call delayed jobs (ring timeout at +60 s, cap at +30 min, liveness
  check at +N) are the primary clock, with a low-frequency safety sweep that
  only visits tenants with active calls (tracked in a Redis set).

**D2 · HIGH · A midnight thundering herd with no per-tenant fairness**
- Where: `comms-call-record-sweep-scheduler.js:20-40`; `workers.js`
  (`call-transcribe` concurrency 2).
- What: 2 jobs per tenant×env are queued at 00:00 UTC for the whole fleet. A
  single platform Groq key and LLM budget are shared, so provider 429s cause
  more failures, which cause more reprocessing. One tenant's backlog starves
  every other tenant's transcripts.
- Fix: spread tenants across the day (hash the slug to an hour), use
  per-tenant queues or group rate limits (BullMQ groups), and back off on
  provider 429s.

**D3 · HIGH · Pooled DB connections are held while waiting on third parties**
- Where: `jobs/handlers/call-transcribe.js:34-35` wraps the whole
  `processCall` (`pipeline.service.js:599-790`): per-part Groq calls with
  retries and sleeps, then the LLM.
- What: each job holds a connection for minutes. On the pooled sandbox path it
  is one long open transaction (`registry.service.js:480-490`).
- Fix: fetch state, release the connection, call the vendors, then reacquire
  a connection for short writes.

**D4 · HIGH · An hourly fleet fan-out for metrics, with full scans**
- Where: `jobs/handlers/comms-call-metrics.js:47-57`;
  `services/platform/comms-metrics.service.js:84-198`.
- What: the alert tick re-aggregates every tenant×env serially every hour.
  That is exactly the fan-out the file header says it avoids.
  `WHERE started_at >= $1` has no supporting index: 14020's claim that
  `ix_comms_call_group (group_id, started_at)` serves it is wrong.
- Fix: increment counters at each terminal transition (in Redis or a platform
  table), aggregate daily, and add `ix_comms_call_started (started_at)` in a
  new migration.

**D5 · MEDIUM · The sustained-failure alarm mixes sandbox and live, and pages on no-audio calls**
- Where: `comms-metrics.service.js:332-341` (`GROUP BY tenant_slug` only).
- Fix: group by `(tenant_slug, env)`, alert on live only, and exclude
  `NO_RECORDING` (A5).

**D6 · MEDIUM · Presence fan-out is O(N²) and wrong with more than one replica**
- Where: `src/realtime/index.js:372,383` (tenant-wide broadcast per connect or
  disconnect); `:56` (per-process socket counter).
- What: mobile reconnect storms broadcast to the whole tenant. A user
  connected to two replicas is shown offline when one tab closes.
- Fix: keep presence in Redis with TTL keys; clients subscribe only to their
  contacts' presence and fetch a snapshot on connect.

**D7 · MEDIUM · One tenant DB connection per ICE candidate**
- Where: `src/realtime/index.js:266-272`.
- Fix: cache the participant pair per socket per call (see C5).

**D8 · MEDIUM · Unbounded Redis keys per tenant**
- Where: the online SET and offline ZSET never expire (B3).

**D9 · MEDIUM · Unbounded queries**
- Where: `smartcomm.call.repo.js:263-272` (purge read has no LIMIT and deletes
  serially); `smartcomm.repo.js` `PARTNER_SQL` (three correlated subqueries
  per channel row on every channel-list read).
- Fix: batch the purge (LIMIT 500 and loop); use one lateral join for the
  partner.

**D10 · MEDIUM · The live log re-uploads the whole list every 30 s**
- Where: `client/src/features/comms/call/live-transcript.ts:209`.
- What: bytes and DB upserts grow O(n²) over a 30-minute call.
- Fix: send only new segments (track the last acknowledged `seq`).

**D11 · LOW · Metric days can be off by one**
- Where: `comms-metrics.service.js:75,88,134`.
- What: `date_trunc` uses the tenant session's timezone, node-pg parses
  `date` into local time, and `toISOString` then shifts the day when the
  process timezone is not UTC.
- Fix: `(started_at AT TIME ZONE 'UTC')::date` and return `metric_date::text`.

**D12 · LOW · The wrong "env" is logged**
- Where: `smartcomm.call.service.js:738` logs `process.env.NODE_ENV` as the
  tenant env.

### E. Client call engine, recorder and live capture

**E1 · HIGH · ICE restart never happens, so any network change drops the call after 10 s**
- Where: `client/src/features/comms/call/call-engine.ts:493-512`.
- What: `pc.restartIce()` depends on a `negotiationneeded` handler, and there
  isn't one. No restart offer is ever sent. The fallback path only runs in
  browsers without `restartIce`, which means no current browser.
- Fix: implement the "perfect negotiation" pattern (`onnegotiationneeded` →
  `setLocalDescription()` → signal; polite/impolite roles to resolve glare).

**E2 · HIGH · Remote ICE candidates are dropped instead of queued**
- Where: `call-session.ts:632-635` (ignored until the callee has an engine);
  `call-engine.ts:360-371` (errors swallowed before the remote description is
  set).
- What: the caller's candidates sent while the phone is ringing are lost.
  Setup then depends on the accidental full re-offer in E3.
- Fix: buffer candidates per call until `remoteDescription` is set, then apply
  them in order. Handle end-of-candidates.

**E3 · HIGH · Every call sends the offer twice, and the two race**
- Where: `call-session.ts:650-653`.
- What: `call:accepted` re-sends the offer whenever no answer has been applied,
  which is always true at that moment. The callee may apply two offers
  concurrently with the `pendingOffer` path, and the resulting
  `InvalidStateError` is swallowed, so some setups fail intermittently.
- Fix: covered by perfect negotiation (E1). Re-offer only on an explicit
  "callee ready, did not receive offer" signal.

**E4 · HIGH · Remote audio can be silently blocked by autoplay rules**
- Where: `call-engine.ts:407-416`.
- What: `new Audio()` with `autoplay` and no `play()` call or rejection
  handling. For the caller, the track arrives up to 60 s after the tap; on
  push-accept there was never a gesture. iOS and Chrome can block playback,
  giving a connected but silent call.
- Fix: create the `<audio>` element on the dial/answer gesture, call `play()`,
  and show a "Tap to hear" control if it is rejected.

**E5 · HIGH · The noise filter can silence the outgoing microphone, and cannot load in production**
- Where: `noise-suppression.ts:69-82,137-150`; `src/server.js:159-195`.
- What:
  - The `AudioContext` is created after async work, without `resume()`, and at
    the device sample rate. RNNoise needs 48 kHz.
  - A suspended context sends silence while the UI says "on".
  - The CSP has no `'wasm-unsafe-eval'`, so WebAssembly compilation is refused
    and the filter always reports "could not load".
  - The filter is ON by default for every tenant.
- Fix: create the context with `{ sampleRate: 48000 }` on the user gesture and
  call `resume()`. Add `'wasm-unsafe-eval'` to `script-src`. Detect silence on
  the output and fall back to the raw track. Default the filter OFF until it is
  verified on devices.

**E6 · HIGH · A microphone or engine failure leaves a live call on the server**
- Where: `call-session.ts:353-377,379-409`.
- What: if `getUserMedia` is denied or `start()` throws, `dial()` and
  `answer()` just return to idle. There is no cancel or hang-up, so the callee
  keeps ringing for a caller who has gone, or an answered call stays IN_CALL
  with both users busy until the cap.
- Fix: open the mic before dialing or accepting, and on any engine failure
  call `hangup` or `fail`.

**E7 · MEDIUM · Double-dial race**
- Where: `call-session.ts:353-363`.
- What: the phase changes only after the POST returns. A double tap sends two
  POSTs; the second fails with CALLER_BUSY and sets the UI to idle while call
  #1 rings with the mic open.
- Fix: set an in-flight `dialing` phase synchronously.

**E8 · MEDIUM · Other devices keep ringing, then show a false "Missed call"**
- Where: `call-session.ts:637-654,326-349`; `comms-live.tsx:145-147`.
- What: when the call is answered on the phone, the desk tab keeps its ring
  screen and tone for up to 60 s. It then reads the row (IN_CALL, no end
  reason) and toasts "Missed call — X".
- Fix: on `call:accepted` for a call this device is ringing for, stop the ring
  and show "Answered on another device".

**E9 · MEDIUM · The live transcript leaks timers and restarts in a storm**
- Where: `live-transcript.ts:171,176-183`.
- What: each recogniser restart creates a new 30 s flush interval without
  clearing the previous one, and `stop()` clears only the last. The leaked
  intervals keep POSTing `/live-log` after the call has ended, until the page
  reloads. Permission or network errors restart the recogniser every 250 ms for
  the whole call.
- Fix: create one interval, back off on errors, and stop after N consecutive
  failures.

**E10 · HIGH · Speech recognition runs alongside the call microphone**
- Where: `call-session.ts:251-267`; `live-transcript.ts`.
- What: on Android Chrome the continuous recogniser plays a start/stop chime at
  every restart during the call and competes with WebRTC for the mic. Chrome
  sends that audio to Google's servers (see G2).
- Fix: remove the live capture. The server transcript plus the fixed recorder
  (A3) is the reliable path.

**E11 · MEDIUM · Recorder uploads are fragile**
- Where: `call-recorder.ts:192-245`.
- What:
  - A failed part upload is never retried (`lost += 1`).
  - Uploads compete with the call's audio every 2 minutes.
  - The last part is lost if the tab closes after hang-up.
  - `part_count` is a running index, so gaps cannot be detected.
- Fix: retry with backoff, persist pending parts in IndexedDB until
  acknowledged, and upload the tail with the "side complete" call (A2).

**E12 · MEDIUM · Presence is never seeded**
- Where: `client/src/features/comms/presence.ts:30`; the server has no
  snapshot event.
- What: everyone shows as offline when the app loads. The outgoing call screen
  says "Their device looks offline" on most calls, and dots go stale after a
  reconnect.
- Fix: send a presence snapshot on connect and reset the map on reconnect.

**E13 · MEDIUM · The screen stays on against the user's cheek**
- Where: `wake-keepalive.ts`.
- What: a screen wake lock during calls, with no proximity sensor on the web,
  leads to accidental taps on Mute, Hang up or the noise toggle.
- Fix: do not hold a screen wake lock for audio calls, or add a "lock
  controls" state.

**E14 · LOW · Dead code, and no call history**
- `getCallTurn` and `listCalls` are never used, so there is no call history or
  missed-call list anywhere.
- `call:ringing_sent` is emitted but never handled.

### F. Call UI and design-system violations (glassmorphism)

**F1 · HIGH · Glassmorphism on the call and ring screens**
- Where: `call-overlay.tsx:92,156,166,176`; `incoming-ring.tsx:37`;
  `call-summary-card.tsx` (`bg-card/60`, `bg-background/60`).
- What: full-screen 97%-opaque tinted layers with `backdrop-blur-sm`,
  translucent `bg-card/90` pills and alpha-tinted chips. The blur is invisible
  at 97% opacity but is still recomposited every frame while the timer ticks.
  That is expensive on low-end Android phones and drains battery over a
  30-minute call, and it looks muddy.
- Fix: opaque `bg-background` surfaces, token borders, no `backdrop-filter`.

**F2 · HIGH · The call screen breaks white-labelling**
- Where: `call-overlay.tsx:194,217`; `incoming-ring.tsx:39`;
  `summary-draft.tsx` (EN/FR toggles); `calls-page.tsx` (checkbox);
  `text-white` at `call-overlay.tsx:205`, `incoming-ring.tsx:55,66`.
- What: these use the Praxis house blue (`--brand-blue`, `text-brand-blue-ink`)
  instead of the tenant's `--primary`, and raw white on `--bad`/`--ok` fills
  instead of `--destructive`/`--destructive-foreground`. The tenant's brand
  disappears on the one full-screen surface.
- Fix: use `--primary`/`text-primary-ink` for accents and the destructive/ok
  token pairs for buttons.

**F3 · MEDIUM · Banners overlap the name and timer**
- Where: `call-overlay.tsx:156,166,176`.
- What: the banners are absolutely positioned at `top-4`, `top-20` and
  `top-24`, so they collide with each other and with the header and the 48 px
  timer.
- Fix: put the banners in a normal flex column.

**F4 · MEDIUM · The call blocks the whole app**
- What: a full-screen modal with no minimise option. A dispatcher cannot open
  the shipment they are discussing.
- Fix: a dockable in-call bar that keeps the call running while the user
  navigates.

**F5 · MEDIUM · Hand-rolled controls instead of design-system primitives**
- Where: raw `<input type="checkbox">` (`call-overlay.tsx:214`,
  `calls-page.tsx`); the summary panel is a `role="dialog"` div with no focus
  trap or Escape handling (`summary-draft.tsx:142`); raw `<textarea>`; "✕"/"×"
  glyph buttons.
- Fix: use `Switch`, `Dialog`/`Sheet`, `Field` and `IconButton` per
  FRONTEND_GUIDE §3.5.

**F6 · MEDIUM · No recording notice before answering**
- Where: `incoming-ring.tsx` (props: name, seconds, accept, decline).
- What: only the hidden-tab notification mentions recording. In the app, the
  callee learns the call is recorded only after connecting.
- Fix: show the recording notice on the ring screen.

**F7 · MEDIUM · The caller cannot edit AI key points or follow-ups before posting**
- Where: `summary-draft.tsx:230-265`.
- What: only the prose is editable. AI-generated "verbatim quotes" are posted
  under the colleague's name with no way to remove a wrong one except
  discarding everything. Discard is irreversible and has no `useConfirm`.
- Fix: make each item editable or removable, and confirm Discard.

**F8 · MEDIUM · Due dates shown as ISO (breaks the day-first rule)**
- Where: `summary-draft.tsx:258` shows `f.due` as `YYYY-MM-DD`.
- Fix: `dateDmy(f.due)`.

**F9 · LOW · Accessibility and motion details**
- `animate-pulse` on the Answer button and `animate-fade-in` ignore
  reduced-motion.
- The `role="timer"` aria-label changes every second.
- "Incoming call from " renders with an empty name.
- The hang-up label is a detached paragraph.

**F10 · LOW · Feature gating is missing in the UI**
- The phone icon renders on every DIRECT thread even when the `calls` feature
  is off (`team-chat.tsx:511,1007`), so a tap gives a 403.
- The "Call audio" tab in the Comms hub shows company settings (MOD-70) to
  every user, and regular staff get an error state.

### G. Privacy and compliance

**G1 · HIGH · Recording, transcription and AI summaries are on by default for every tenant**
- Where: seeds `9134`, `9135`; migrations `14000:105-107` and `14010:279-281`.
- What: all plans, default ON. Tenant admins cannot switch recording off
  themselves: 14010 seeds no `ai_feature_flag` row for `call_recording`, and
  the Calls page does not expose it.
- Fix: default OFF, with an explicit tenant-admin opt-in and a documented
  lawful basis.

**G2 · HIGH · Third-party processors are not disclosed**
- What: audio goes to Groq; transcripts go to the DeepSeek → Gemini LLM chain
  (per the pipeline's own header); live microphone audio goes to Google through
  the Web Speech API; STUN goes to Google. The banner says only "recorded and
  summarized". There are cross-border transfers and no processor disclosure.
- Fix: list the processors in the consent text and the tenant DPA, allow
  region-pinned vendors, and remove Web Speech (E10).

**G3 · MEDIUM · Transcripts and summaries are kept forever, and audio retention is broken**
- What: text is kept indefinitely by design, with no erasure path for a data
  subject request. Audio retention is undermined by orphaned objects (B12).
- Fix: a configurable text retention period and an erasure procedure.

**G4 · MEDIUM · Every employee's "last seen" is visible to every colleague**
- Where: `smartcomm.repo.js` `listColleagues`; tenant-wide presence
  broadcasts.
- What: no opt-out; this raises an employee-monitoring concern.
- Fix: a per-user privacy setting, and share presence only with DIRECT
  contacts.

**G5 · MEDIUM · The callee cannot refuse recording**
- What: the only option is to decline the call.
- Fix: a per-call "don't record" choice on the ring screen, or require both
  parties to consent.

### H. Tests, docs and process

**H1 · HIGH · The tests mock exactly the parts that are broken**
- Where: `client/e2e/call.spec.ts:146` stubs `**/api/tenant/smartcomm/**`;
  unit tests use fake peer connections.
- What: the wrong keepalive URL, worker-side socket no-ops, the CSP-blocked
  WASM, headerless recorder parts, the CHECK violation and the TURN
  configuration never run in any test.
- Fix: one real end-to-end test (API, worker, Postgres, Redis, two Chromium
  pages) covering a 3-minute call through transcription, notification and
  opening the draft.

**H2 · HIGH · The manual device matrix was never run**
- Where: `doc/SMART_COMMS_CALLS_MANUAL_MATRIX.md`.
- What: 30 rows, 36 cells marked PENDING, none marked PASS. It shipped anyway.
- Fix: make the matrix a release gate.

**H3 · MEDIUM · The docs describe behaviour the code does not have**
- "Clients re-trigger the job when the last part lands": nothing does.
- "TURN credential scoped to the user": it is not.
- "No code path posts without this write in the same transaction": false.
- "The dial icon does not render when calls is off": it does.
- "The index serves the metrics read": it does not.
- `.env.example` says an empty STUN value omits STUN: it defaults to Google.
- Compose says the username is `<expiry>:<user>`: the code uses `<expiry>`.
- Fix: correct each statement, and make every guarantee a test.

**H4 · LOW · Comment volume hides defects**
- What: about a third of the lines are narrative comments. They assert intent
  the code then contradicts (H3), and reviewers read the comment instead of the
  code.
- Fix: cut the narrative to short "why" notes and move guarantees into tests.

---

## 3. Fix plan

Sizes assume one engineer who knows this codebase: **S** ≤ 1 day, **M** 2–4
days, **L** 1–2 weeks. Each phase ends with its acceptance check.

### Phase 1: stop the phantom notifications and calls (S–M, ship first)
1. Remove notifications from sweep-initiated runs. Notify once per draft,
   tracked by a `notified_at` column (A4).
2. Pipeline gate: recording on AND at least one part or segment, otherwise
   terminal `NO_RECORDING` (A5, B5).
3. Move the record sweep to a working-hours cron per tenant timezone, with
   hashed hour spreading (A1, D2).
4. Separate the ring deep link (`?ring=`) from the summary link. Add a summary
   route and screen, plus a "Calls" list with pending drafts (A6, E14).
5. Fix the keepalive URL (A10). Change liveness to an allowed reason and
   `Math.max` (B1, B2).
6. Add the env to the user room (A9). Add a worker-side socket emitter through
   the Redis adapter (`@socket.io/redis-emitter`) so worker events reach
   clients (A6).
7. **Accept:** a 3-minute test call produces exactly one notification within a
   minute of hang-up, and it opens the draft. Nothing is sent at night. A closed
   tab ends the call within 60 s.

### Phase 2: rebuild the recorder and pipeline triggers (M)
1. One complete file per part (restart the `MediaRecorder` per part), or a
   single resumable upload (A3).
2. A "side complete" endpoint that triggers processing, and certification only
   when all declared parts are present (A2, E11).
3. Idempotent reprocessing: skip certified sides, cap attempts on every branch,
   exclude ineligible calls (B4, B5).
4. Draft state guards and a transactional send (B6, B7).
5. Deterministic storage keys, upload window and byte quotas, validator caps
   that match the columns (B11–B13).
6. Remove the Web Speech live capture (E9, E10, G2, C7, D10).
7. **Accept:** 5-, 15- and 29-minute calls on Chrome Android, Safari iOS and
   desktop all reach CERTIFIED. A re-run never bills a certified side.

### Phase 3: security hardening (M)
1. coturn: `--static-auth-secret`, realm, external-ip, TLS on 443, denied
   private ranges, quotas, pinned image, health check (C1, C3).
2. Call-scoped, rate-limited TURN credentials issued only for live calls (C2).
3. Reject `CALL` attachments on the generic post route, and resolve cards only
   for SENT summaries (C4).
4. Relay only for live calls, with payload validation, per-socket rate limits
   and a cached participant pair (C5, D7).
5. Dial rate limits, callee must be ACTIVE, DND and block (C6). Queue and
   rate-limit regeneration (C8). Throttle presence writes (C9). Gate AI reads
   on the recording flag (C10).
6. **Accept:** a TURN SSRF probe to 169.254.169.254 and 172.17.0.1 is refused.
   Posting a foreign `call_id` returns 422.

### Phase 4: call engine reliability (M–L)
1. Perfect negotiation with `onnegotiationneeded`, buffered ICE candidates, and
   no blind re-offer (E1–E3).
2. Audio element created on the gesture with `play()` handling (E4). Noise
   filter at 48 kHz with `resume()`, CSP `'wasm-unsafe-eval'`, and default OFF
   until the device matrix passes (E5).
3. Mic before dial or accept; hang up on engine failure; in-flight dial guard
   (E6, E7). "Answered on another device" (E8). Presence snapshot (E12).
4. Service-worker actions for Accept/Decline, a close-on-end push, and
   auto-close at `expires_at` (A7, A8).
5. **Accept:** the full manual matrix passes (H2), including switching from
   Wi-Fi to 4G mid-call, and push Answer/Decline from the lock screen.

### Phase 5: scale across tenants (M)
1. Per-call delayed jobs as the clock, with a safety sweep only over tenants
   that have active calls (D1).
2. Per-tenant fair queues for transcription, with 429-aware backoff (D2).
   Release DB connections during vendor calls (D3).
3. Event-driven metric counters plus a `started_at` index; group alarms by env
   (D4, D5, D11).
4. Redis presence with TTLs, no tenant-wide broadcast (D6, D8, B3). Bounded
   purge and partner join (D9).
5. **Accept:** a load test with 200 tenants, 50 concurrent calls, and one
   tenant with 2,000 backlogged transcripts. Ring timeouts stay within 5 s for
   every other tenant, and the tenant DB pools stay under their budget.

### Phase 6: new call screen and privacy (M)
1. Opaque, token-driven call and ring screens using the tenant `--primary` and
   destructive tokens, with no blur. Banners in the layout flow. A dockable
   in-call bar. Design-system `Switch`/`Dialog`/`Field`. Reduced motion
   (F1–F5, F9).
2. Recording notice on the ring screen, and a per-call "don't record" option
   (F6, G5). Editable key points and follow-ups, confirmed discard, day-first
   dates (F7, F8). UI feature gates (F10).
3. Recording OFF by default, a tenant admin switch, a processor disclosure,
   text retention and an erasure path, and a presence privacy setting
   (G1–G4).

### Phase 7: make it stay fixed (S–M)
1. Real end-to-end test through the worker (H1). The manual matrix as a
   release gate (H2).
2. Correct every false statement in H3.

---

## 4. Keep, rebuild, remove

| Part | Decision | Why |
| --- | --- | --- |
| `comms_call` schema, partial unique "one active call" indexes, guarded `transition()` | **Keep** | Correct and race-safe; the hardest part to get right. |
| Call REST routes and membership authorisation | **Keep**, with fixes B8, B9, C2, C6 | Sound model: the channel is the authorisation. |
| Transcript tables (`is_current`, certified CHECK) | **Keep**, with B4 fixed | Good audit design; the bug is in the writer, not the schema. |
| Shared `call-summary` schema | **Keep** | One contract for the API and the editor. |
| Record pipeline triggers, sweep and notifications | **Rebuild** | The source of the 01:00 loop; its trigger model is wrong. |
| Client engine signalling | **Rebuild** (perfect negotiation) | ICE restart, candidate buffering and the double offer are structural. |
| Recorder | **Rebuild** | The part model is incompatible with how browser recorders produce files. |
| Call and ring screens | **Rebuild** | Glassmorphism, white-label breaks, overlapping layout, no minimise. |
| Web Speech live capture | **Remove** | Privacy, Android chimes, timer leaks; not needed once A3 is fixed. |
| 15-second per-tenant sweep | **Replace** with per-call delayed jobs | Does not scale across tenants (D1). |
| RNNoise filter | **Park**, default OFF | Cannot load under the current CSP; can silence iOS. Re-enable after device tests. |
| coturn service | **Reconfigure** | Security holes and probably non-functional as written. |
| Platform metrics table and screen | **Keep**, change the producer to counters | The table and screen are fine; the hourly fan-out is not. |

**Fix or rewrite?** About 40% of the code (pipeline triggers, engine, recorder,
UI) needs rewriting. The rest needs local fixes. Starting from scratch would
re-derive the schema, the state machine and the shared contract that already
work, so the targeted plan above is the cheaper route.
