"use strict";
/**
 * The ground a training video is filmed on (doc/TRAINING_VIDEOS.md §4): a throwaway tenant on a
 * development database, wearing the tenant's real public branding, with an invented cast and the
 * invitation the newest colleague opens on camera.
 *
 * Everything here writes through the product's own services (branding, users) wherever one exists,
 * so a video shows what a person would have got, and is refused anywhere but a development
 * database on this machine: filming creates records and signs people in, and it must never be able
 * to touch a real tenant.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { CAST, emailOf } = require("./cast");

const SLUG = process.env.VIDEO_TENANT || "smartls";
const BRAND = path.join(__dirname, "brand", SLUG);
/** What the filming browser is told the app's address is: every link on screen reads as the tenant's own. */
const ORIGIN = process.env.VIDEO_ORIGIN || `http://${SLUG}.praxisls.com`;
/** The password filming gives the people it signs in as (never a real person's). */
const PASSWORD = process.env.VIDEO_PASSWORD || "Smart-LS-Demo-2026!";

function config() {
  return require("../../src/config/env").config;
}

/** Refuse anywhere that is not a development database on this machine. */
function guard() {
  const c = config();
  if (c.NODE_ENV === "production" || !["localhost", "127.0.0.1", "::1"].includes(c.DB_HOST))
    throw new Error(`Filming works on a development database on this machine only (NODE_ENV ${c.NODE_ENV}, DB_HOST ${c.DB_HOST}).`);
}

/** A client on the tenant's database with `schema` (live or sandbox) first on the search path. */
async function tenantClient(slug = SLUG, schema = "live") {
  guard();
  const c = config();
  const platform = new Client({ host: c.DB_HOST, port: c.DB_PORT, database: c.DB_NAME, user: c.DB_USER, password: c.DB_PASSWORD });
  await platform.connect();
  const { rows } = await platform.query(
    `SELECT td.db_host, td.db_port, td.db_name, td.live_schema, td.sandbox_schema
       FROM platform.tenant t JOIN platform.tenant_database td ON td.tenant_id = t.tenant_id AND td.is_active
      WHERE t.slug = $1`,
    [slug],
  );
  await platform.end();
  if (!rows[0]) throw new Error(`No tenant '${slug}': provision it first (doc/TRAINING_VIDEOS.md §4.1).`);
  const td = rows[0];
  const client = new Client({
    host: td.db_host, port: td.db_port, database: td.db_name,
    user: c.TENANT_DB_APP_ROLE || c.DB_USER, password: c.DB_PASSWORD,
  });
  await client.connect();
  const name = schema === "sandbox" ? td.sandbox_schema || "sandbox" : td.live_schema || "live";
  await client.query(`SET search_path = ${name}, public`);
  return client;
}

const dataUrl = (file, type) => `data:${type};base64,${fs.readFileSync(path.join(BRAND, file)).toString("base64")}`;

/**
 * The tenant's public branding, as Settings · Appearance and Login would save it from the files in
 * `brand/<slug>/` (logo, favicon, login photograph). The palette and fonts are the ones the real
 * tenant publishes, read from its own `/api/tenant/branding` and committed here as data.
 */
async function applyBranding(log = console.warn) {
  const branding = require("../../src/modules/branding/branding.service");
  const look = JSON.parse(fs.readFileSync(path.join(BRAND, "branding.json"), "utf8"));
  const { logoUrl } = await branding.uploadLogo({ dataUrl: dataUrl("logo.webp", "image/webp"), slug: SLUG });
  const { logoUrl: faviconUrl } = await branding.uploadLogo({ dataUrl: dataUrl("favicon.png", "image/png"), slug: SLUG });
  const { backgroundUrl } = await branding.uploadLoginBackground({ dataUrl: dataUrl("login-background.webp", "image/webp"), slug: SLUG });
  for (const schema of ["live", "sandbox"]) {
    const client = await tenantClient(SLUG, schema);
    try {
      await branding.setBranding(client, { actorId: null, ...look.appearance, logoUrl, faviconUrl });
      await branding.setLogin(client, { actorId: null, ...look.login, backgroundUrl });
    } finally {
      await client.end();
    }
  }
  log(`branding: ${look.appearance.name}, ${look.appearance.primary}, ${look.appearance.fontDisplay.split(",")[0]}`);
}

/** The company record (LIVE), so an invitation names it and every document carries its letterhead. */
async function ensureEntity(log = console.warn) {
  const client = await tenantClient(SLUG, "live");
  try {
    const { rows } = await client.query("SELECT entity_id FROM corporate_entity WHERE is_active ORDER BY created_at LIMIT 1");
    if (rows[0]) return rows[0].entity_id;
    const made = await client.query(
      `INSERT INTO corporate_entity (code, legal_name, trading_name, country_code, doc_prefix, default_language, default_currency, timezone)
       VALUES ('SLS', 'Smart Logistics & Services Ltd', 'Smart LS', 'CM', 'SLS', 'fr', 'XAF', 'Africa/Douala') RETURNING entity_id`,
    );
    log("company: Smart Logistics & Services Ltd");
    return made.rows[0].entity_id;
  } finally {
    await client.end();
  }
}

/**
 * Put the invented cast on the LIVE side: an employee record and a login each, with their roles.
 * The newest colleague (`invite` names them) is sent an invitation, not given a password, so the
 * video can show them accepting it. Idempotent: a person already there is left as they are.
 * Returns { key: { employee_id, user_id } }.
 */
async function ensureCast({ invite: toInvite = [], log = console.warn } = {}) {
  const entityId = await ensureEntity(log);
  const appUser = require("../../src/modules/security/app_user/app_user.service");
  const client = await tenantClient(SLUG, "live");
  // An invitation is mailed as it is made: nothing may leave this machine, and there is no mail server.
  const emailService = require("../../src/services/email.service");
  const realSend = emailService.send;
  emailService.send = async () => ({ suppressed: true });
  const made = {};
  try {
    const roles = Object.fromEntries((await client.query("SELECT code, role_id FROM role")).rows.map((r) => [r.code, r.role_id]));
    let n = 0;
    for (const [key, p] of Object.entries(CAST)) {
      n += 1;
      const email = emailOf(key);
      let emp = (await client.query("SELECT employee_id FROM employee WHERE lower(email::text) = $1", [email])).rows[0];
      if (!emp) {
        emp = (await client.query(
          `INSERT INTO employee (entity_id, full_name, department, job_title, employment_type, staff_no, hired_on,
                                 phone_mobile, place_of_work, gender, civility, nationality, email, status)
           VALUES ($1,$2,$3,$4,'PERMANENT',$5,$6,$7,$8,$9,$10,'Cameroonian',$11,'ACTIVE') RETURNING employee_id`,
          [entityId, p.full_name, p.department, p.job_title, `SLS-${String(n).padStart(3, "0")}`, p.hired_on, p.mobile, p.place_of_work, p.gender, p.civility, email],
        )).rows[0];
      }
      let user = (await client.query("SELECT user_id, employee_id FROM app_user WHERE lower(email::text) = $1", [email])).rows[0];
      if (!user) {
        const created = await appUser.createUser(client, {
          data: {
            email, full_name: p.full_name, employee_id: emp.employee_id,
            role_ids: p.roles.map((c) => roles[c]),
            ...(toInvite.includes(key) ? { invite: true } : { password: PASSWORD }),
          },
          actor: {}, tenantId: null, origin: ORIGIN,
        });
        user = { user_id: created.user_id };
        log(`cast: ${p.full_name}, ${p.job_title}${toInvite.includes(key) ? " (invited)" : ""}`);
      } else if (!user.employee_id) {
        await client.query("UPDATE app_user SET employee_id = $1 WHERE user_id = $2", [emp.employee_id, user.user_id]);
      }
      made[key] = { employee_id: emp.employee_id, user_id: user.user_id };
    }
    // Who reports to whom, once everyone has a record.
    for (const [key, p] of Object.entries(CAST))
      if (p.reports_to) await client.query("UPDATE employee SET reports_to = $1 WHERE employee_id = $2", [made[p.reports_to].employee_id, made[key].employee_id]);
  } finally {
    emailService.send = realSend;
    await client.end();
  }
  return made;
}

/**
 * The TEST sample data (the sandbox seed: clients, operations files, fleet, finance), loaded once.
 * Without it the Control Tower in TEST is as empty as LIVE and nothing on a screen is worth showing.
 */
async function ensureSandboxData(log = console.warn) {
  const client = await tenantClient(SLUG, "sandbox");
  let n = 0;
  try {
    n = (await client.query("SELECT count(*)::int AS n FROM dossier")).rows[0].n;
  } finally {
    await client.end();
  }
  if (n > 0) return;
  log("TEST data: loading the sandbox seed");
  require("node:child_process").execFileSync("node", [path.join(__dirname, "..", "tenant", "seed-sandbox.js"), `--slug=${SLUG}`], { stdio: "inherit" });
}

/**
 * Issue a fresh invitation to one of the cast and keep the message the product would have mailed
 * (nothing leaves the machine). The invitation's link is single use and one live link at a time, so
 * a scene asks for it just before the shot that opens it (`reset` first puts a colleague who has a
 * password back to invited). Returns { to, subject, html, link }.
 */
async function invite(key, out, { reset = false } = {}) {
  const email = emailOf(key);
  const emailService = require("../../src/services/email.service");
  const appUser = require("../../src/modules/security/app_user/app_user.service");
  const client = await tenantClient(SLUG, "live");
  const real = emailService.send;
  let caught = null;
  emailService.send = async (_c, msg) => { caught = msg; return { suppressed: true }; };
  try {
    const { rows } = await client.query("SELECT user_id FROM app_user WHERE lower(email::text) = $1", [email]);
    if (!rows[0]) throw new Error(`No login for ${email}: run the prepare step first.`);
    // A colleague who already chose a password is put back as they were when invited (an unknown
    // password), so a retake of the chapter meets the page a new colleague meets.
    if (reset) {
      const secret = require("node:crypto").randomBytes(48).toString("hex");
      await client.query("UPDATE app_user SET password_hash = $1 WHERE user_id = $2", [await require("argon2").hash(secret, { type: require("argon2").argon2id }), rows[0].user_id]);
    }
    await appUser.issueInvite(client, { userId: rows[0].user_id, origin: ORIGIN, actor: {} });
  } finally {
    emailService.send = real;
    await client.end();
  }
  if (!caught) throw new Error("The invitation was not captured.");
  const link = /href="([^"]+)"/.exec(caught.html)[1];
  const mail = { to: caught.to, subject: caught.subject, html: caught.html, link };
  if (out) {
    fs.mkdirSync(path.join(out, "mail"), { recursive: true });
    fs.writeFileSync(path.join(out, "mail", `${key}.json`), JSON.stringify(mail, null, 1));
  }
  return mail;
}

/** Make sure `email` can sign in with the filming password, without signing in (that would be a new device). */
async function ready(emails) {
  const argon2 = require("argon2");
  const client = await tenantClient(SLUG, "live");
  try {
    for (const email of emails) {
      const { rows } = await client.query("SELECT user_id, password_hash FROM app_user WHERE lower(email::text) = lower($1)", [email]);
      if (!rows[0]) throw new Error(`No login for ${email}: run the prepare step first.`);
      const ok = await argon2.verify(rows[0].password_hash, PASSWORD).catch(() => false);
      if (!ok) {
        await client.query("UPDATE app_user SET password_hash = $1, status = 'ACTIVE' WHERE user_id = $2", [await argon2.hash(PASSWORD, { type: argon2.argon2id }), rows[0].user_id]);
      }
    }
  } finally {
    await client.end();
  }
}

/**
 * Put people back to "no way in but the password". `what` names the ways to take away (all three by
 * default): "passkeys", "pin" and "authenticator" (the app and its recovery codes). A chapter about
 * setting one up films it from this state, so a retake meets what a first time does. Their sessions
 * and the devices the product has seen them on are left alone.
 */
async function resetSecurity(emails, what = ["passkeys", "pin", "authenticator"]) {
  const client = await tenantClient(SLUG, "live");
  try {
    for (const email of emails) {
      const { rows } = await client.query("SELECT user_id FROM app_user WHERE lower(email::text) = lower($1)", [email]);
      if (!rows[0]) throw new Error(`No login for ${email}: run the prepare step first.`);
      const id = rows[0].user_id;
      if (what.includes("passkeys")) await client.query("DELETE FROM webauthn_credential WHERE user_id = $1", [id]);
      if (what.includes("pin")) await client.query("DELETE FROM user_quick_pin WHERE user_id = $1", [id]);
      if (what.includes("authenticator")) {
        await client.query("DELETE FROM user_mfa_recovery_code WHERE user_id = $1", [id]);
        await client.query("UPDATE app_user SET is_2fa_enabled = false, totp_secret_enc = NULL WHERE user_id = $1", [id]);
      }
    }
  } finally {
    await client.end();
  }
}

/** Give someone a Quick PIN through the product's own service (as My Security's form does), off camera. */
async function setQuickPin(email, pin) {
  const appUser = require("../../src/modules/security/app_user/app_user.service");
  const client = await tenantClient(SLUG, "live");
  // Setting a PIN tells the person by notification and email: nothing may leave this machine.
  const emailService = require("../../src/services/email.service");
  const realSend = emailService.send;
  emailService.send = async () => ({ suppressed: true });
  try {
    const { rows } = await client.query("SELECT user_id FROM app_user WHERE lower(email::text) = lower($1)", [email]);
    if (!rows[0]) throw new Error(`No login for ${email}: run the prepare step first.`);
    await appUser.setQuickPin(client, { userId: rows[0].user_id, pin, currentPassword: PASSWORD });
  } finally {
    emailService.send = realSend;
    await client.end();
  }
}

/**
 * Turn the authenticator app on for someone, as if they had scanned the square, so a later shot can
 * show the sign-in that asks for a code. Returns the secret (the key under "No camera?").
 */
async function enableAuthenticator(email, frequency = "always") {
  const { authenticator } = require("otplib");
  const encryption = require("../../src/services/encryption.service");
  const secret = authenticator.generateSecret();
  const client = await tenantClient(SLUG, "live");
  try {
    const { rowCount } = await client.query(
      "UPDATE app_user SET is_2fa_enabled = true, totp_secret_enc = $1, mfa_frequency = $2 WHERE lower(email::text) = lower($3)",
      [encryption.encrypt(secret), frequency, email],
    );
    if (!rowCount) throw new Error(`No login for ${email}: run the prepare step first.`);
  } finally {
    await client.end();
  }
  return secret;
}

/** The six-digit code an authenticator app would show right now for `secret`. */
const codeFor = (secret) => require("otplib").authenticator.generate(secret);

/**
 * A code with at least `margin` seconds left before it changes. A code is typed over several seconds and the
 * product checks it against the current thirty-second step only, so one typed across the change is refused:
 * wait for the next step when too little of this one is left.
 */
async function freshCode(secret, margin = 14) {
  const left = () => require("otplib").authenticator.timeRemaining();
  if (left() < margin) await new Promise((r) => setTimeout(r, (left() + 0.5) * 1000));
  return codeFor(secret);
}

module.exports = { SLUG, ORIGIN, PASSWORD, guard, tenantClient, applyBranding, ensureEntity, ensureCast, ensureSandboxData, invite, ready, resetSecurity, setQuickPin, enableAuthenticator, codeFor, freshCode };
