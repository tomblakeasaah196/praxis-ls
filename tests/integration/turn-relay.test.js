"use strict";
/**
 * Calls audit C1 and C3 against a REAL coturn: the entrypoint's config starts
 * a relay, a credential signed like the API's allocates, and the relay refuses
 * 169.254.169.254, 172.17.0.1, loopback and RFC 1918 peers.
 *
 * Opt-in: RUN_TURN_TESTS=1 with `turnserver` and `turnutils_uclient` on PATH
 * (the `coturn` package). The same checks run on a deployed relay through
 * scripts/turn-check.sh.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const has = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0;
const enabled = process.env.RUN_TURN_TESTS === "1" && has("turnserver") && has("turnutils_uclient");
const maybe = enabled ? describe : describe.skip;

maybe("coturn relay (real server)", () => {
  const PORT = "23478";
  const SECRET = "integration-secret";
  let server;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-it-"));
    server = spawn("sh", [path.join(ROOT, "docker", "coturn", "docker-entrypoint.sh")], {
      env: {
        PATH: process.env.PATH,
        TURN_CREDENTIAL_SECRET: SECRET,
        TURN_REALM: "turn.test",
        TURN_PORT_UDP: PORT,
        TURN_MIN_PORT: "51000",
        TURN_MAX_PORT: "51100",
        TURN_CONF: path.join(dir, "turnserver.conf"),
      },
      stdio: "ignore",
    });
    await new Promise((r) => setTimeout(r, 1500));
  });

  afterAll(() => {
    if (server) server.kill("SIGTERM");
    spawnSync("pkill", ["-f", `listening-port=${PORT}|turnserver -c .*turn-it-`]);
  });

  test("allocation works; private and metadata peers are refused", () => {
    const out = spawnSync("sh", [path.join(ROOT, "scripts", "turn-check.sh"), "127.0.0.1", PORT], {
      env: { PATH: process.env.PATH, TURN_CREDENTIAL_SECRET: SECRET },
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(out.stdout).toMatch(/PASS: allocation and relay to a public peer/);
    expect(out.stdout).toMatch(/PASS: a wrong secret cannot allocate/);
    expect(out.stdout).toMatch(/PASS: peer 169\.254\.169\.254 refused/);
    expect(out.stdout).toMatch(/PASS: peer 172\.17\.0\.1 refused/);
    expect(out.stdout).toMatch(/ALL TURN CHECKS PASSED/);
    expect(out.status).toBe(0);
  }, 130_000);
});
