"use strict";

const repo = require("../../src/modules/vault/compliance_flag/compliance_flag.repo");

describe("compliance flag listings", () => {
  test("paged listing filters before LIMIT and includes a match count", async () => {
    const client = {
      query: jest.fn(async () => ({
        rows: [{ flag_id: "flag-26", severity: "WARN", _total: "26" }],
      })),
    };

    const result = await repo.listFlagsPaged(client, {
      severity: "WARN",
      includeResolved: false,
      limit: "25",
      offset: "25",
    });

    expect(result).toEqual({
      rows: [{ flag_id: "flag-26", severity: "WARN" }],
      total: 26,
    });
    const [sql, params] = client.query.mock.calls[0];
    expect(params).toEqual([25, 25, "WARN"]);
    expect(sql).toContain("WHERE resolved_at IS NULL AND severity = $3");
    expect(sql).toContain("COUNT(*) OVER() AS _total");
    expect(sql).toContain(
      "ORDER BY severity DESC, created_at DESC, flag_id DESC LIMIT $1 OFFSET $2",
    );
  });

  test("keeps the existing unbounded array listing for service consumers", async () => {
    const rows = [{ flag_id: "flag-1" }, { flag_id: "flag-2" }];
    const client = { query: jest.fn(async () => ({ rows })) };

    await expect(
      repo.listFlags(client, { includeResolved: true }),
    ).resolves.toEqual(rows);
    expect(client.query.mock.calls[0][0]).not.toContain("LIMIT");
  });
});
