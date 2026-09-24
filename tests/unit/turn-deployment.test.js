"use strict";
/**
 * Calls audit C1 and C3: the coturn deployment.
 *
 *   C3  coturn never read TURNSHAREKEY, so every credential the API minted was
 *       refused; there was no realm, no external IP and no TLS listener.
 *   C1  with host networking and no denied peers, any credential holder could
 *       relay to 169.254.169.254 (cloud metadata) or 172.17.0.1 / 127.0.0.1
 *       (Postgres and Redis on this host).
 *
 * The entrypoint renders coturn's config. It is run here with a stand-in
 * `turnserver` that prints the config it was handed, so the rendered file is
 * asserted exactly. tests/integration/turn-relay.test.js runs the real relay.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const ROOT = path.join(__dirname, "..", "..");
const ENTRYPOINT = path.join(ROOT, "docker", "coturn", "docker-entrypoint.sh");

function render(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-"));
  const fake = path.join(dir, "turnserver");
  // Prints the file after -c, and the file's mode, then exits.
  fs.writeFileSync(fake, '#!/bin/sh\nstat -c "MODE=%a" "$2"\ncat "$2"\n', { mode: 0o755 });
  const out = spawnSync("sh", [ENTRYPOINT], {
    env: {
      PATH: process.env.PATH,
      TURNSERVER_BIN: fake,
      TURN_CONF: path.join(dir, "turnserver.conf"),
      ...env,
    },
    encoding: "utf8",
  });
  return { status: out.status, stdout: out.stdout, stderr: out.stderr, lines: out.stdout.split("\n") };
}

const BASE = { TURN_CREDENTIAL_SECRET: "s3cret-value", TURN_REALM: "turn.example.com" };

describe("coturn entrypoint (C3: credentials coturn can verify)", () => {
  test("uses the REST scheme with the API's shared secret, and a realm", () => {
    const r = render(BASE);
    expect(r.status).toBe(0);
    expect(r.lines).toEqual(expect.arrayContaining([
      "use-auth-secret",
      "static-auth-secret=s3cret-value",
      "realm=turn.example.com",
      "fingerprint",
    ]));
    expect(r.stdout).not.toMatch(/TURNSHAREKEY/);
  });

  test("the secret is written to a file only its owner can read, not argv", () => {
    const r = render(BASE);
    expect(r.lines[0]).toBe("MODE=600");
  });

  test.each([
    [{ TURN_REALM: "turn.example.com" }, /TURN_CREDENTIAL_SECRET/],
    [{ TURN_REALM: "turn.example.com", TURN_CREDENTIAL_SECRET: "__set_me__" }, /TURN_CREDENTIAL_SECRET/],
    [{ TURN_CREDENTIAL_SECRET: "x" }, /TURN_REALM/],
    [{ ...BASE, TURN_TLS_PORT: "5349" }, /TURN_TLS_CERT/],
    [{ ...BASE, TURN_USER_QUOTA: "12; rm -rf" }, /not a number/],
  ])("refuses to start when misconfigured (%#)", (env, message) => {
    const r = render(env);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(message);
  });

  test("behind cloud NAT it advertises the public address and refuses it as a peer", () => {
    const r = render({ ...BASE, TURN_EXTERNAL_IP: "203.0.113.7" });
    expect(r.lines).toEqual(expect.arrayContaining(["external-ip=203.0.113.7", "denied-peer-ip=203.0.113.7"]));
  });

  test("a TLS listener for turns: when a port and certificate are given", () => {
    const r = render({ ...BASE, TURN_TLS_PORT: "5349", TURN_TLS_CERT: "/c.pem", TURN_TLS_KEY: "/k.pem" });
    expect(r.lines).toEqual(expect.arrayContaining(["tls-listening-port=5349", "cert=/c.pem", "pkey=/k.pem"]));
    expect(r.lines).not.toContain("no-tls");
  });
});

describe("coturn entrypoint (C1: the relay cannot reach private networks)", () => {
  const r = render(BASE);
  const denied = r.lines.filter((l) => l.startsWith("denied-peer-ip=")).map((l) => l.slice(15));

  test.each([
    "0.0.0.0-0.255.255.255",
    "10.0.0.0-10.255.255.255",
    "100.64.0.0-100.127.255.255",
    "127.0.0.0-127.255.255.255",
    "169.254.0.0-169.254.255.255",
    "172.16.0.0-172.31.255.255",
    "192.168.0.0-192.168.255.255",
    "::1",
    "fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
  ])("denies %s", (range) => {
    expect(denied).toContain(range);
  });

  test("no TCP relay, no multicast peers, quotas and a bandwidth cap", () => {
    expect(r.lines).toEqual(expect.arrayContaining([
      "no-tcp-relay",
      "no-multicast-peers",
      "user-quota=12",
      "total-quota=400",
      "max-bps=64000",
    ]));
    expect(r.stdout).not.toMatch(/allowed-peer-ip|allow-loopback-peers/);
  });
});

describe("docker-compose `turn` service", () => {
  const compose = yaml.load(fs.readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8"));
  const turn = compose.services.turn;

  test("runs the entrypoint, not coturn's bare flags", () => {
    expect(turn.entrypoint).toEqual(["/bin/sh", "/usr/local/bin/praxis-turn-entrypoint.sh"]);
    expect(turn.volumes).toContain("./docker/coturn/docker-entrypoint.sh:/usr/local/bin/praxis-turn-entrypoint.sh:ro");
    expect(turn.command).toBeUndefined();
    expect(JSON.stringify(turn.environment)).not.toMatch(/TURNSHAREKEY/);
  });

  test("the image is pinned by version and digest", () => {
    expect(turn.image).toMatch(/^coturn\/coturn:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
  });

  test("the health check makes a real allocation", () => {
    expect(turn.healthcheck.test.join(" ")).toMatch(/turnutils_uclient -W/);
  });

  test("every variable the service reads is in env.js", () => {
    const envSrc = fs.readFileSync(path.join(ROOT, "src", "config", "env.js"), "utf8");
    for (const key of Object.keys(turn.environment)) {
      expect(envSrc).toMatch(new RegExp(`\\n\\s+${key}:`));
    }
  });
});
