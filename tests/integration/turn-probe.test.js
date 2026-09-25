"use strict";
/**
 * The platform call check's TURN allocation (calls audit PR-7, O5) against a
 * REAL coturn: a credential signed like the API's allocates a relay address,
 * a wrong secret is refused with 401, and a relay that is not there times out.
 *
 * Opt-in like tests/integration/turn-relay.test.js: RUN_TURN_TESTS=1 with
 * `turnserver` on PATH and a non-loopback IPv4 (TURN_TEST_RELAY_IP, else the
 * first one found).
 */
const os = require("os");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const has = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0;
const IP = process.env.TURN_TEST_RELAY_IP
  || Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal)?.address;
const enabled = process.env.RUN_TURN_TESTS === "1" && has("turnserver") && !!IP;
const maybe = enabled ? describe : describe.skip;
const PORT = 34790;
const SECRET = "probe-integration-secret";

const cred = (secret) => {
  const username = `${Math.floor(Date.now() / 1000) + 120}:canary-test`;
  return { username, password: crypto.createHmac("sha1", secret).update(username).digest("base64") };
};

maybe("the TURN probe against a real relay", () => {
  let relay;
  const { allocate } = require("../../src/services/platform/turn-probe");
  beforeAll(async () => {
    relay = spawn("turnserver", [
      "-n", "--listening-port", String(PORT), "--listening-ip", IP, "--relay-ip", IP,
      "--use-auth-secret", `--static-auth-secret=${SECRET}`, "--realm", "turn.test",
      "--no-tls", "--no-dtls", "--no-cli", "--log-file", "stdout",
    ], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 1500));
  });
  afterAll(() => relay && relay.kill());

  test("a credential signed with the relay's secret allocates, and is released", async () => {
    const out = await allocate({ host: IP, port: PORT, ...cred(SECRET) });
    expect(out).toMatchObject({ ok: true, relayed: expect.stringMatching(/^\d+\.\d+\.\d+\.\d+:\d+$/) });
  });

  test("a wrong secret is refused with 401", async () => {
    expect(await allocate({ host: IP, port: PORT, ...cred("not-the-secret") })).toMatchObject({ ok: false, code: 401 });
  });

  test("a relay that is not there times out", async () => {
    expect(await allocate({ host: IP, port: PORT + 3, ...cred(SECRET), timeoutMs: 1000 })).toMatchObject({ ok: false });
  });
});
