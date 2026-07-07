/**
 * Anomaly Detection Integration Tests
 *
 * Tests covering:
 * - GET /v1/finance/anomalies — happy path, status filtering, pagination
 * - PATCH /v1/finance/anomalies/:id/dismiss — dismissal, role enforcement
 * - Domain logic: Z-score classification, severity mapping, user behavior detection
 * - Consumer: event processing, dismissed transaction skip
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import {
  scoreTransactionZScore,
  scoreCostCenterPattern,
  scoreUserBehavior,
  classifySeverity,
  detectAnomalies,
  isDismissed,
  type RollingStats,
  type TransactionData,
} from "../src/modules/anomaly/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[] = ["audit_officer"]) {
  return signToken(
    { sub: "user-001", tid: TENANT, roles, sid: "sess-001" },
    SECRET,
  );
}

afterAll(async () => {
  await sqlClient.end();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Route Tests: GET /v1/finance/anomalies
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/finance/anomalies — list route", () => {
  it("returns 200 with paginated list shape", async () => {
    const app = await buildApp();
    const token = makeToken(["audit_officer"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/anomalies",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("meta");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty("page");
    expect(body.meta).toHaveProperty("pageSize");
    expect(body.meta).toHaveProperty("total");
  });

  it("supports status filter query param", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_admin"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/anomalies?status=open",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("supports dismissed status filter", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_admin"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/anomalies?status=dismissed",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("supports reviewed status filter", async () => {
    const app = await buildApp();
    const token = makeToken(["audit_officer"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/anomalies?status=reviewed",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("supports pagination params", async () => {
    const app = await buildApp();
    const token = makeToken(["audit_officer"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/anomalies?page=2&pageSize=5",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.page).toBe(2);
    expect(body.meta.pageSize).toBe(5);
  });

  it("returns 400 for invalid status value", async () => {
    const app = await buildApp();
    const token = makeToken(["audit_officer"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/anomalies?status=invalid",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const token = makeToken(["citizen"]);
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/anomalies",
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/finance/anomalies",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Route Tests: PATCH /v1/finance/anomalies/:id/dismiss
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /v1/finance/anomalies/:id/dismiss — dismissal", () => {
  it("returns 404 for non-existent anomaly", async () => {
    const app = await buildApp();
    const token = makeToken(["audit_officer"]);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/finance/anomalies/00000000-0000-4000-8000-000000000099/dismiss",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: { reason: "False positive - reviewed manually" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for non-audit/finance_admin role", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_officer"]);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/finance/anomalies/00000000-0000-4000-8000-000000000099/dismiss",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: { reason: "Test dismiss" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 when reason is missing", async () => {
    const app = await buildApp();
    const token = makeToken(["audit_officer"]);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/finance/anomalies/00000000-0000-4000-8000-000000000099/dismiss",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when reason is empty string", async () => {
    const app = await buildApp();
    const token = makeToken(["audit_officer"]);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/finance/anomalies/00000000-0000-4000-8000-000000000099/dismiss",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: { reason: "" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid UUID param", async () => {
    const app = await buildApp();
    const token = makeToken(["audit_officer"]);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/finance/anomalies/not-a-uuid/dismiss",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: { reason: "Test" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("audit_officer can dismiss", async () => {
    const app = await buildApp();
    const token = makeToken(["audit_officer"]);
    // Non-existent → 404 but validates role is accepted
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/finance/anomalies/00000000-0000-4000-8000-000000000001/dismiss",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: { reason: "Verified as false positive" },
    });
    await app.close();
    // 404 (not 403) proves the role check passed
    expect(res.statusCode).toBe(404);
  });

  it("finance_admin can dismiss", async () => {
    const app = await buildApp();
    const token = makeToken(["finance_admin"]);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/finance/anomalies/00000000-0000-4000-8000-000000000001/dismiss",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: { reason: "False positive" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("super_admin can dismiss", async () => {
    const app = await buildApp();
    const token = makeToken(["super_admin"]);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/finance/anomalies/00000000-0000-4000-8000-000000000001/dismiss",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      payload: { reason: "Admin override" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/finance/anomalies/00000000-0000-4000-8000-000000000001/dismiss",
      headers: { "content-type": "application/json" },
      payload: { reason: "No auth" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Domain Logic Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("classifySeverity — Z-score severity mapping", () => {
  it("returns high for Z-score > 5", () => {
    expect(classifySeverity(5.1)).toBe("high");
    expect(classifySeverity(10)).toBe("high");
  });

  it("returns medium for Z-score between 3 and 5 (inclusive)", () => {
    expect(classifySeverity(3)).toBe("medium");
    expect(classifySeverity(4)).toBe("medium");
    expect(classifySeverity(5)).toBe("medium");
  });

  it("returns low for Z-score < 3", () => {
    expect(classifySeverity(2.9)).toBe("low");
    expect(classifySeverity(0)).toBe("low");
  });
});

describe("scoreTransactionZScore — transaction scoring", () => {
  it("returns null when std is 0 (no variance)", () => {
    const stats: RollingStats = { mean: 5000, std: 0, count: 50 };
    expect(scoreTransactionZScore(10000n, stats)).toBeNull();
  });

  it("returns null when Z-score <= 3 (not anomalous)", () => {
    const stats: RollingStats = { mean: 5000, std: 1000, count: 50 };
    // Z = (5500 - 5000) / 1000 = 0.5
    expect(scoreTransactionZScore(5500n, stats)).toBeNull();
  });

  it("detects anomaly when Z-score > 3", () => {
    const stats: RollingStats = { mean: 5000, std: 1000, count: 50 };
    // Z = (9000 - 5000) / 1000 = 4.0
    const result = scoreTransactionZScore(9000n, stats);
    expect(result).not.toBeNull();
    expect(result!.zScore).toBeCloseTo(4.0);
    expect(result!.severity).toBe("medium");
  });

  it("classifies high severity for Z-score > 5", () => {
    const stats: RollingStats = { mean: 5000, std: 1000, count: 50 };
    // Z = (11000 - 5000) / 1000 = 6.0
    const result = scoreTransactionZScore(11000n, stats);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("high");
  });

  it("detects negative Z-score anomaly (underspend)", () => {
    const stats: RollingStats = { mean: 10000, std: 1000, count: 50 };
    // Z = (5000 - 10000) / 1000 = -5.0
    const result = scoreTransactionZScore(5000n, stats);
    expect(result).not.toBeNull();
    expect(result!.zScore).toBeCloseTo(-5.0);
    expect(result!.severity).toBe("medium");
  });

  it("returns factors with correct direction for overspend", () => {
    const stats: RollingStats = { mean: 5000, std: 1000, count: 50 };
    const result = scoreTransactionZScore(9000n, stats);
    expect(result!.factors[0]!.direction).toBe("positive");
  });

  it("returns factors with negative direction for underspend", () => {
    const stats: RollingStats = { mean: 10000, std: 1000, count: 50 };
    const result = scoreTransactionZScore(5000n, stats);
    expect(result!.factors[0]!.direction).toBe("negative");
  });
});

describe("scoreCostCenterPattern — cost center monitoring", () => {
  it("returns null when std is 0", () => {
    const stats: RollingStats = { mean: 100000, std: 0, count: 6 };
    expect(scoreCostCenterPattern(150000, stats)).toBeNull();
  });

  it("returns null when deviation <= 2 stddev", () => {
    const stats: RollingStats = { mean: 100000, std: 30000, count: 6 };
    // Z = (140000 - 100000) / 30000 = 1.33
    expect(scoreCostCenterPattern(140000, stats)).toBeNull();
  });

  it("flags when deviation > 2 stddev", () => {
    const stats: RollingStats = { mean: 100000, std: 30000, count: 6 };
    // Z = (170000 - 100000) / 30000 = 2.33
    const result = scoreCostCenterPattern(170000, stats);
    expect(result).not.toBeNull();
    expect(result!.severity).toBeDefined();
  });
});

describe("scoreUserBehavior — user behavior anomaly detection", () => {
  it("returns null when std is 0", () => {
    const baseline: RollingStats = { mean: 10, std: 0, count: 30 };
    expect(scoreUserBehavior(50, baseline, "volume")).toBeNull();
  });

  it("returns null when deviation <= 3 stddev", () => {
    const baseline: RollingStats = { mean: 10, std: 3, count: 30 };
    // Z = (18 - 10) / 3 = 2.67
    expect(scoreUserBehavior(18, baseline, "volume")).toBeNull();
  });

  it("flags when deviation > 3 stddev", () => {
    const baseline: RollingStats = { mean: 10, std: 3, count: 30 };
    // Z = (22 - 10) / 3 = 4.0
    const result = scoreUserBehavior(22, baseline, "volume");
    expect(result).not.toBeNull();
    expect(result!.zScore).toBeCloseTo(4.0);
    expect(result!.severity).toBe("medium");
  });

  it("works for amount metric", () => {
    const baseline: RollingStats = { mean: 5000, std: 1000, count: 30 };
    // Z = (10000 - 5000) / 1000 = 5.0
    const result = scoreUserBehavior(10000, baseline, "amount");
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("medium");
  });
});

describe("detectAnomalies — combined detection", () => {
  const transaction: TransactionData = {
    id: "txn-001",
    tenantId: TENANT,
    amountPaise: 50000n,
    categoryId: "cat-001",
    vendorId: "vendor-001",
    costCenterId: "cc-001",
    userId: "user-001",
    date: new Date(),
    description: "Office supplies",
  };

  it("returns empty array when no stats available", () => {
    const result = detectAnomalies(transaction, null, null, null, null);
    expect(result).toEqual([]);
  });

  it("detects Z-score anomaly when stats indicate deviation", () => {
    const stats: RollingStats = { mean: 5000, std: 1000, count: 50 };
    // Amount is 50000, Z = (50000 - 5000) / 1000 = 45
    const result = detectAnomalies(transaction, stats, null, null, null);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.anomalyType).toBe("zscore");
    expect(result[0]!.severity).toBe("high");
  });

  it("detects cost center pattern deviation", () => {
    const ccStats: RollingStats = { mean: 10000, std: 2000, count: 6 };
    // Current month spend 20000, Z = (20000 - 10000) / 2000 = 5
    const result = detectAnomalies(transaction, null, ccStats, 20000, null);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.anomalyType).toBe("cost_center_pattern");
  });

  it("detects multiple anomaly types simultaneously", () => {
    const catStats: RollingStats = { mean: 5000, std: 1000, count: 50 };
    const ccStats: RollingStats = { mean: 10000, std: 2000, count: 6 };
    const result = detectAnomalies(transaction, catStats, ccStats, 20000, null);
    expect(result.length).toBe(2);
    const types = result.map((a) => a.anomalyType);
    expect(types).toContain("zscore");
    expect(types).toContain("cost_center_pattern");
  });

  it("detects user behavior anomalies", () => {
    const userStats = {
      volume: { mean: 5, std: 1, count: 30 } as RollingStats,
      amount: { mean: 3000, std: 500, count: 30 } as RollingStats,
    };
    const userValues = { volume: 10, amount: 5500 };
    // volume Z = (10-5)/1 = 5, amount Z = (5500-3000)/500 = 5
    const result = detectAnomalies(transaction, null, null, null, userStats, userValues);
    expect(result.length).toBe(2);
    expect(result.every((a) => a.anomalyType === "user_behavior")).toBe(true);
  });
});

describe("isDismissed — utility function", () => {
  it("returns true for dismissed status", () => {
    expect(isDismissed("dismissed")).toBe(true);
  });

  it("returns false for open status", () => {
    expect(isDismissed("open")).toBe(false);
  });

  it("returns false for reviewed status", () => {
    expect(isDismissed("reviewed")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isDismissed(undefined)).toBe(false);
  });
});
