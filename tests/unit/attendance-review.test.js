"use strict";
/**
 * 14403: a punch is never refused. These are the pure rules that decide how a
 * punch is RECORDED instead: the tap time, what is held for a manager, and how
 * a location reading that arrives after the tap is treated.
 */
const review = require("../../src/modules/hr/attendance/attendance.review");
const { locationStatus } = require("../../src/modules/hr/attendance/attendance.location");

const NOW = new Date("2026-10-12T08:00:00Z");
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

describe("resolveTapTime", () => {
  it("uses the receipt time when the phone sends none", () => {
    expect(review.resolveTapTime({ receivedAt: NOW })).toEqual({ at: NOW, offline: false, implausible: false });
  });

  it("keeps a live tap a few seconds old, and does not call it offline", () => {
    const r = review.resolveTapTime({ tappedAt: ago(6_000), receivedAt: NOW });
    expect(r.at.toISOString()).toBe(ago(6_000));
    expect(r.offline).toBe(false);
    expect(r.implausible).toBe(false);
  });

  it("keeps an offline tap's own time and says it was offline", () => {
    const r = review.resolveTapTime({ tappedAt: ago(2 * 60 * 60_000), receivedAt: NOW });
    expect(r.at.toISOString()).toBe(ago(2 * 60 * 60_000));
    expect(r.offline).toBe(true);
    expect(r.implausible).toBe(false);
  });

  it("clamps ordinary clock skew to the receipt time without calling it a problem", () => {
    const r = review.resolveTapTime({ tappedAt: new Date(NOW.getTime() + 30_000).toISOString(), receivedAt: NOW });
    expect(r).toEqual({ at: NOW, offline: false, implausible: false });
  });

  it("does not believe a tap in the future", () => {
    const r = review.resolveTapTime({ tappedAt: new Date(NOW.getTime() + 60 * 60_000).toISOString(), receivedAt: NOW });
    expect(r.at).toEqual(NOW);
    expect(r.implausible).toBe(true);
  });

  it("marks a tap more than a day old, and one before the moment it must follow", () => {
    expect(review.resolveTapTime({ tappedAt: ago(25 * 60 * 60_000), receivedAt: NOW }).implausible).toBe(true);
    expect(
      review.resolveTapTime({ tappedAt: ago(60 * 60_000), receivedAt: NOW, notBefore: ago(30 * 60_000) }).implausible,
    ).toBe(true);
  });
});

describe("reviewFor", () => {
  it("never holds anything when every policy is off", () => {
    expect(review.reviewFor({ geofenceMode: "off", within: false, devicePolicy: "off" })).toEqual({
      reasons: [], held: false, status: null,
    });
  });

  it("flags off-site under warn and holds it under block", () => {
    expect(review.reviewFor({ geofenceMode: "warn", within: false })).toMatchObject({ reasons: ["off_site"], held: false });
    expect(review.reviewFor({ geofenceMode: "block", within: false })).toMatchObject({ reasons: ["off_site"], status: "PENDING" });
  });

  it("does not hold a punch with no location under block: there is nothing to judge", () => {
    expect(review.reviewFor({ geofenceMode: "block", within: null }).held).toBe(false);
  });

  it("treats a missing device id as unapproved only under block", () => {
    expect(review.reviewFor({ devicePolicy: "warn", devicePresented: false }).reasons).toEqual([]);
    expect(review.reviewFor({ devicePolicy: "block", devicePresented: false })).toMatchObject({ reasons: ["device"], held: true });
    expect(review.reviewFor({ devicePolicy: "warn", devicePresented: true, deviceTrusted: false })).toMatchObject({ reasons: ["device"], held: false });
  });

  it("always holds a time that does not add up", () => {
    expect(review.reviewFor({ geofenceMode: "off", timeImplausible: true })).toMatchObject({ reasons: ["offline_time"], held: true });
  });
});

describe("mergeReview", () => {
  it("never reopens a manager's decision", () => {
    const merged = review.mergeReview({ review_status: "APPROVED", review_reasons: ["device"] }, { reasons: ["off_site"], held: true });
    expect(merged).toEqual({ review_status: "APPROVED", review_reasons: ["device", "off_site"] });
  });

  it("keeps a punch held once held", () => {
    expect(review.mergeReview({ review_status: "PENDING", review_reasons: ["device"] }, { reasons: [], held: false }).review_status).toBe("PENDING");
  });
});

describe("classifyLateFix", () => {
  const punchAt = NOW;
  const after = (ms) => new Date(NOW.getTime() + ms);
  it("judges inside the window, labels after it, drops what is too late or too early", () => {
    expect(review.classifyLateFix({ punchAt, fixAt: after(19_000) }).kind).toBe("judge");
    expect(review.classifyLateFix({ punchAt, fixAt: after(21_000) }).kind).toBe("late");
    expect(review.classifyLateFix({ punchAt, fixAt: after(11 * 60_000) }).kind).toBe("ignore");
    expect(review.classifyLateFix({ punchAt, fixAt: after(-1_000) }).kind).toBe("ignore");
  });
});

describe("locationStatus for a late reading", () => {
  it("is delayed_gps, never an on-site verdict", () => {
    expect(locationStatus({ location_source: "late", latitude: 4, longitude: 9, within_geofence: true })).toBe("delayed_gps");
    expect(locationStatus({ location_source: "late", latitude: null, longitude: null })).toBe("no_gps");
  });
});

describe("14403 migration", () => {
  const fs = require("fs");
  const path = require("path");
  const sql = fs
    .readFileSync(path.join(__dirname, "../../migrations/tenant/14403_attendance_never_refused.sql"), "utf8")
    // Comments carry the DOWN block and prose; only executable SQL counts.
    .replace(/--[^\n]*/g, "");

  it("lets location_source take 'late' by dropping the 10740 CHECK", () => {
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS attendance_log_location_source_check/);
  });

  it("adds no CHECK and no foreign key to the existing tables (13791 hazard)", () => {
    expect(sql).not.toMatch(/ADD CONSTRAINT/i);
    expect(sql).not.toMatch(/REFERENCES/i);
  });

  it("enforces in code what a CHECK would have: the validator's lists match the module's", () => {
    const { schemas } = require("../../src/modules/hr/attendance/attendance.validator");
    expect(schemas.clockIn.shape.location_error.unwrap().options).toEqual(review.LOCATION_ERRORS);
  });
});
