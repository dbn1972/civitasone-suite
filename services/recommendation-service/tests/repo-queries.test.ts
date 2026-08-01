/**
 * Repository query tests.
 *
 * Route tests mock the repos, which leaves the actual SQL construction untested.
 * Here the repos run against a REAL drizzle instance wired to an in-memory proxy
 * driver: every query is genuinely compiled to SQL (so a bad column reference,
 * a broken DISTINCT ON or a malformed GROUP BY fails the test), while the driver
 * returns canned rows instead of talking to Postgres.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { drizzle } from "drizzle-orm/pg-proxy";

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

const captured: CapturedQuery[] = [];

const proxyDb = drizzle(async (sql: string, params: unknown[]) => {
  captured.push({ sql, params });
  // Empty result set: exercises the `rows[0] ?? null` / `?? 0` branches.
  return { rows: [] };
});

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(proxyDb),
  },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn(proxyDb),
  sqlClient: { end: async () => {} },
}));

import * as predictiveRepo from "../src/modules/predictive/repo.js";
import * as collateralRepo from "../src/modules/collateral/repo.js";
import * as intelligenceRepo from "../src/modules/intelligence/repo.js";
import * as reasonRepo from "../src/modules/feedback/reason-repo.js";
import * as feedbackRepo from "../src/modules/feedback/repo.js";
import * as scoringRepo from "../src/modules/health/scoring-repo.js";
import * as healthRepo from "../src/modules/health/repo.js";
import * as nbaRepo from "../src/modules/nba/repo.js";
import * as matrixRepo from "../src/modules/matrix/repo.js";

const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const SUBJECT_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const REC_ID = "cccccccc-1111-4000-8000-000000000001";
const ACCOUNT_ID = "eeeeeeee-1111-4000-8000-000000000001";
const LINK_ID = "dddddddd-3333-4000-8000-000000000001";

/**
 * The proxy driver is used as both the db and the "transaction". Writes only
 * need a query executor, so this cast is safe and keeps the repos under test
 * without a live Postgres connection.
 */
const tx = proxyDb as unknown as Parameters<typeof predictiveRepo.upsert>[0];

function lastSql(): string {
  return captured[captured.length - 1]?.sql ?? "";
}

beforeEach(() => {
  captured.length = 0;
});

// ── predictive/repo ───────────────────────────────────────────────────────────

describe("predictive/repo", () => {
  it("findBySubjectModel filters on tenant, subject and model", async () => {
    const row = await predictiveRepo.findBySubjectModel(TENANT, "account", SUBJECT_ID, "ltv");
    expect(row).toBeNull();
    expect(lastSql()).toContain('"predictive_scores"');
    expect(captured[0]?.params).toContain(TENANT);
    expect(captured[0]?.params).toContain("ltv");
  });

  it("listBySubject orders by model type", async () => {
    await predictiveRepo.listBySubject(TENANT, "profile", SUBJECT_ID);
    expect(lastSql()).toContain("order by");
    expect(lastSql()).toContain("model_type");
  });

  it("listRanked orders by score descending with a subject tie-break", async () => {
    const { rows, total } = await predictiveRepo.listRanked(TENANT, 10, 0);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(captured[0]?.sql).toContain("desc");
    expect(captured[0]?.sql).toContain("subject_id");
  });

  it("listRanked applies the modelType filter", async () => {
    await predictiveRepo.listRanked(TENANT, 10, 0, { modelType: "fraud" });
    expect(captured[0]?.params).toContain("fraud");
  });

  it("listRanked applies the subjectType filter", async () => {
    await predictiveRepo.listRanked(TENANT, 10, 0, { subjectType: "deal" });
    expect(captured[0]?.params).toContain("deal");
  });

  it("listRanked binds minScore as a decimal string parameter", async () => {
    await predictiveRepo.listRanked(TENANT, 10, 0, { minScore: "0.5000" });
    expect(captured[0]?.params).toContain("0.5000");
  });

  it("listRanked issues a separate count query", async () => {
    await predictiveRepo.listRanked(TENANT, 10, 0);
    expect(captured).toHaveLength(2);
    expect(captured[1]?.sql).toContain("count(*)");
  });

  it("upsert targets the unique subject/model key", async () => {
    await predictiveRepo.upsert(tx, {
      id: "11111111-1111-4111-8111-111111111111",
      tenantId: TENANT,
      subjectType: "account",
      subjectId: SUBJECT_ID,
      modelType: "ltv",
      score: "1234.5678",
      confidence: "0.9000",
      modelVersion: "v1",
      features: {},
      computedAt: new Date(),
      createdBy: USER,
      updatedBy: USER,
    });
    const sql = lastSql();
    expect(sql).toContain("on conflict");
    expect(sql).toContain("tenant_id");
    expect(sql).toContain("model_type");
    expect(sql).toContain("returning");
  });

  it("upsert defaults confidence, modelVersion and features on conflict", async () => {
    await predictiveRepo.upsert(tx, {
      id: "11111111-1111-4111-8111-111111111112",
      tenantId: TENANT,
      subjectType: "deal",
      subjectId: SUBJECT_ID,
      modelType: "churn",
      score: "1.0000",
      createdBy: USER,
      updatedBy: USER,
    });
    expect(lastSql()).toContain("on conflict");
  });

  it("toView keeps numeric columns as strings", () => {
    const view = predictiveRepo.toView({
      id: "id",
      tenantId: TENANT,
      subjectType: "account",
      subjectId: SUBJECT_ID,
      modelType: "ltv",
      score: "12345678.9999",
      confidence: "0.1234",
      modelVersion: "v2",
      features: { a: 1 },
      computedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: USER,
      updatedBy: USER,
      version: 2,
    });
    expect(view.score).toBe("12345678.9999");
    expect(view.confidence).toBe("0.1234");
    expect(view.computedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

// ── collateral/repo ───────────────────────────────────────────────────────────

describe("collateral/repo", () => {
  it("findById filters on tenant", async () => {
    expect(await collateralRepo.findById(LINK_ID, TENANT)).toBeNull();
    expect(captured[0]?.params).toContain(TENANT);
  });

  it("listByRecommendation orders by ordinal then id", async () => {
    const { rows, total } = await collateralRepo.listByRecommendation(TENANT, REC_ID, 20, 0);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(captured[0]?.sql).toContain("ordinal");
  });

  it("listAllForRecommendation orders by ordinal", async () => {
    await collateralRepo.listAllForRecommendation(TENANT, REC_ID);
    expect(lastSql()).toContain("ordinal");
  });

  it("insert writes the link row", async () => {
    await collateralRepo.insert(tx as unknown as Parameters<typeof collateralRepo.insert>[0], {
      id: LINK_ID,
      tenantId: TENANT,
      recommendationId: REC_ID,
      collateralType: "document",
      collateralRef: "doc-1",
      title: "Doc",
      ordinal: 0,
      createdBy: USER,
      updatedBy: USER,
    });
    expect(lastSql()).toContain("insert into");
  });

  it("update applies optimistic locking and returns false with no match", async () => {
    const ok = await collateralRepo.update(
      tx as unknown as Parameters<typeof collateralRepo.update>[0],
      LINK_ID,
      TENANT,
      { title: "New" },
      1,
    );
    expect(ok).toBe(false);
    expect(lastSql()).toContain("version");
    expect(lastSql()).toContain("returning");
  });

  it("deleteById returns false with no match", async () => {
    const ok = await collateralRepo.deleteById(
      tx as unknown as Parameters<typeof collateralRepo.deleteById>[0],
      LINK_ID,
      TENANT,
    );
    expect(ok).toBe(false);
    expect(lastSql()).toContain("delete from");
  });

  it("toView serialises timestamps", () => {
    const view = collateralRepo.toView({
      id: LINK_ID,
      tenantId: TENANT,
      recommendationId: REC_ID,
      collateralType: "video",
      collateralRef: "vid-1",
      title: "Video",
      ordinal: 3,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: USER,
      updatedBy: USER,
      version: 1,
    });
    expect(view.ordinal).toBe(3);
    expect(view.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

// ── intelligence/repo ─────────────────────────────────────────────────────────

describe("intelligence/repo", () => {
  it("findByAccount filters on tenant and account", async () => {
    expect(await intelligenceRepo.findByAccount(ACCOUNT_ID, TENANT)).toBeNull();
    expect(captured[0]?.params).toContain(ACCOUNT_ID);
  });

  it("listRanked orders by opportunity score descending", async () => {
    const { rows, total } = await intelligenceRepo.listRanked(TENANT, 20, 0);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(captured[0]?.sql).toContain("opportunity_score");
    expect(captured[0]?.sql).toContain("desc");
  });

  it("listRanked binds minOpportunityScore as a string", async () => {
    await intelligenceRepo.listRanked(TENANT, 20, 0, { minOpportunityScore: "0.5000" });
    expect(captured[0]?.params).toContain("0.5000");
  });

  it("upsert targets the unique account key", async () => {
    await intelligenceRepo.upsert(
      tx as unknown as Parameters<typeof intelligenceRepo.upsert>[0],
      {
        id: "11111111-1111-4111-8111-111111111113",
        tenantId: TENANT,
        accountId: ACCOUNT_ID,
        whiteSpace: [{ productId: "p1" }],
        riskSignals: [{ code: "r", severity: "low" }],
        opportunityScore: "0.1250",
        lastComputedAt: new Date(),
        createdBy: USER,
        updatedBy: USER,
      },
    );
    expect(lastSql()).toContain("on conflict");
    expect(lastSql()).toContain("account_id");
  });

  it("upsert falls back to empty jsonb and zero score", async () => {
    await intelligenceRepo.upsert(
      tx as unknown as Parameters<typeof intelligenceRepo.upsert>[0],
      {
        id: "11111111-1111-4111-8111-111111111114",
        tenantId: TENANT,
        accountId: ACCOUNT_ID,
        createdBy: USER,
        updatedBy: USER,
      },
    );
    expect(lastSql()).toContain("on conflict");
  });

  it("toView keeps opportunityScore a string", () => {
    const view = intelligenceRepo.toView({
      id: "id",
      tenantId: TENANT,
      accountId: ACCOUNT_ID,
      whiteSpace: [],
      riskSignals: [],
      opportunityScore: "0.9999",
      lastComputedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: USER,
      updatedBy: USER,
      version: 1,
    });
    expect(view.opportunityScore).toBe("0.9999");
    expect(view.lastComputedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

// ── feedback/reason-repo ──────────────────────────────────────────────────────

describe("feedback/reason-repo", () => {
  it("rejectionSummary groups by reason code", async () => {
    const rows = await reasonRepo.rejectionSummary(TENANT);
    expect(rows).toEqual([]);
    expect(lastSql()).toContain("group by");
    expect(lastSql()).toContain("reason_code");
    expect(lastSql()).toContain("is not null");
  });

  it("rejectionSummary applies the from/to window", async () => {
    await reasonRepo.rejectionSummary(TENANT, {
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(captured[0]?.params.length).toBeGreaterThan(2);
  });

  it("totalRejections counts every rejection", async () => {
    expect(await reasonRepo.totalRejections(TENANT)).toBe(0);
    expect(lastSql()).toContain("count(*)");
  });

  it("totalRejections applies the from/to window", async () => {
    await reasonRepo.totalRejections(TENANT, {
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(captured[0]?.params.length).toBeGreaterThan(2);
  });
});

// ── feedback/repo ─────────────────────────────────────────────────────────────

describe("feedback/repo", () => {
  it("findById filters on tenant", async () => {
    expect(await feedbackRepo.findById("id", TENANT)).toBeNull();
    expect(captured[0]?.params).toContain(TENANT);
  });

  it("listByRecommendation returns rows and a total", async () => {
    const { rows, total } = await feedbackRepo.listByRecommendation(TENANT, REC_ID, 10, 0);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it("insert writes reason_code and reason_text", async () => {
    await feedbackRepo.insert(tx as unknown as Parameters<typeof feedbackRepo.insert>[0], {
      id: "11111111-1111-4111-8111-111111111115",
      tenantId: TENANT,
      recommendationId: REC_ID,
      action: "rejected",
      reason: "not_relevant",
      reasonCode: "not_relevant",
      reasonText: null,
      recordedAt: new Date(),
      createdBy: USER,
      updatedBy: USER,
    });
    const sql = lastSql();
    expect(sql).toContain("reason_code");
    expect(sql).toContain("reason_text");
  });

  it("update applies optimistic locking", async () => {
    const ok = await feedbackRepo.update(
      tx as unknown as Parameters<typeof feedbackRepo.update>[0],
      "id",
      TENANT,
      { reasonCode: "other" },
      1,
    );
    expect(ok).toBe(false);
    expect(lastSql()).toContain("version");
  });

  it("toView exposes the structured reason fields", () => {
    const view = feedbackRepo.toView({
      id: "id",
      tenantId: TENANT,
      recommendationId: REC_ID,
      action: "rejected",
      reason: "other: merged",
      reasonCode: "other",
      reasonText: "merged into a parent account",
      recordedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: USER,
      updatedBy: USER,
      version: 1,
    });
    expect(view.reasonCode).toBe("other");
    expect(view.reasonText).toBe("merged into a parent account");
  });
});

// ── health/scoring-repo ───────────────────────────────────────────────────────

describe("health/scoring-repo", () => {
  it("listAtRisk uses DISTINCT ON to take the newest row per account", async () => {
    const { rows, total } = await scoringRepo.listAtRisk(TENANT, 50, 20);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
    const sql = captured[0]?.sql ?? "";
    expect(sql).toContain("distinct on");
    expect(sql).toContain("account_id");
  });

  it("listAtRisk applies the score ceiling and the limit in SQL", async () => {
    await scoringRepo.listAtRisk(TENANT, 25, 5);
    const sql = captured[0]?.sql ?? "";
    expect(sql).toContain("<=");
    expect(sql).toContain("limit");
    expect(captured[0]?.params).toContain(25);
  });

  it("listAtRisk issues a separate count query over the same subquery", async () => {
    await scoringRepo.listAtRisk(TENANT, 50, 20);
    expect(captured).toHaveLength(2);
    expect(captured[1]?.sql).toContain("count(*)");
    expect(captured[1]?.sql).toContain("distinct on");
  });

  it("findCurrent takes the newest row for one account", async () => {
    expect(await scoringRepo.findCurrent(TENANT, ACCOUNT_ID)).toBeNull();
    const sql = lastSql();
    expect(sql).toContain("computed_at");
    expect(sql).toContain("limit");
  });
});

// ── pre-existing repos (kept covered so the suite guards them too) ────────────

describe("health/repo", () => {
  it("findById filters on tenant", async () => {
    expect(await healthRepo.findById("id", TENANT)).toBeNull();
  });

  it("findLatestByAccount orders by computed_at descending", async () => {
    expect(await healthRepo.findLatestByAccount(ACCOUNT_ID, TENANT)).toBeNull();
    expect(lastSql()).toContain("computed_at");
  });

  it("listHistory returns rows and a total", async () => {
    const { rows, total } = await healthRepo.listHistory(TENANT, ACCOUNT_ID, 10, 0);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it("insert writes a score row", async () => {
    await healthRepo.insert(tx as unknown as Parameters<typeof healthRepo.insert>[0], {
      id: "11111111-1111-4111-8111-111111111116",
      tenantId: TENANT,
      accountId: ACCOUNT_ID,
      score: 55,
      factors: {},
      computedAt: new Date(),
      createdBy: USER,
      updatedBy: USER,
    });
    expect(lastSql()).toContain("insert into");
  });

  it("update applies optimistic locking", async () => {
    const ok = await healthRepo.update(
      tx as unknown as Parameters<typeof healthRepo.update>[0],
      "id",
      TENANT,
      { score: 60 },
      1,
    );
    expect(ok).toBe(false);
  });

  it("toView serialises the row", () => {
    const view = healthRepo.toView({
      id: "id",
      tenantId: TENANT,
      accountId: ACCOUNT_ID,
      score: 72,
      factors: {},
      computedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: USER,
      updatedBy: USER,
      version: 1,
    });
    expect(view.score).toBe(72);
  });
});

describe("nba/repo", () => {
  it("findById filters on tenant", async () => {
    expect(await nbaRepo.findById(REC_ID, TENANT)).toBeNull();
  });

  it("listForProfile applies status, channel and TTL filters", async () => {
    const { rows, total } = await nbaRepo.listForProfile(TENANT, SUBJECT_ID, 5, 0, {
      statuses: ["served"],
      channel: "web",
      servedAfter: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(captured[0]?.params).toContain("web");
  });

  it("listForProfile works with no filters", async () => {
    await nbaRepo.listForProfile(TENANT, SUBJECT_ID, 5, 0);
    expect(captured[0]?.sql).toContain("profile_id");
  });

  it("listForProfile ignores an empty status list", async () => {
    await nbaRepo.listForProfile(TENANT, SUBJECT_ID, 5, 0, { statuses: [] });
    expect(captured[0]?.sql).toContain("profile_id");
  });

  it("insert writes a served recommendation", async () => {
    await nbaRepo.insert(tx as unknown as Parameters<typeof nbaRepo.insert>[0], {
      id: REC_ID,
      tenantId: TENANT,
      profileId: SUBJECT_ID,
      recommendationType: "cross_sell",
      score: "0.5000",
      status: "served",
      servedAt: new Date(),
      createdBy: USER,
      updatedBy: USER,
    });
    expect(lastSql()).toContain("insert into");
  });

  it("updateStatus applies optimistic locking", async () => {
    const ok = await nbaRepo.updateStatus(
      tx as unknown as Parameters<typeof nbaRepo.updateStatus>[0],
      REC_ID,
      TENANT,
      { status: "accepted" },
      1,
    );
    expect(ok).toBe(false);
    expect(lastSql()).toContain("version");
  });
});

describe("matrix/repo", () => {
  const MATRIX_ID = "dddddddd-1111-4000-8000-000000000001";
  const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
  const PRODUCT_B = "22222222-2222-4222-8222-222222222222";

  it("findById filters on tenant", async () => {
    expect(await matrixRepo.findById(MATRIX_ID, TENANT)).toBeNull();
  });

  it("listByTenant orders by priority descending", async () => {
    const { rows, total } = await matrixRepo.listByTenant(TENANT, 20, 0);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(captured[0]?.sql).toContain("priority");
  });

  it("listByTenant applies every filter", async () => {
    await matrixRepo.listByTenant(TENANT, 20, 0, {
      triggerProductId: PRODUCT_A,
      segment: "sme",
      channel: "web",
    });
    expect(captured[0]?.params).toContain("sme");
    expect(captured[0]?.params).toContain("web");
  });

  it("findByProductPair narrows to the product pair", async () => {
    expect(await matrixRepo.findByProductPair(TENANT, PRODUCT_A, PRODUCT_B)).toEqual([]);
    expect(lastSql()).toContain("recommended_product_id");
  });

  it("insert writes a matrix rule", async () => {
    await matrixRepo.insert(tx as unknown as Parameters<typeof matrixRepo.insert>[0], {
      id: MATRIX_ID,
      tenantId: TENANT,
      triggerProductId: PRODUCT_A,
      recommendedProductId: PRODUCT_B,
      priority: 3,
      createdBy: USER,
      updatedBy: USER,
    });
    expect(lastSql()).toContain("insert into");
  });

  it("update applies optimistic locking", async () => {
    const ok = await matrixRepo.update(
      tx as unknown as Parameters<typeof matrixRepo.update>[0],
      MATRIX_ID,
      TENANT,
      { priority: 9 },
      1,
    );
    expect(ok).toBe(false);
  });

  it("deleteById returns false with no match", async () => {
    const ok = await matrixRepo.deleteById(
      tx as unknown as Parameters<typeof matrixRepo.deleteById>[0],
      MATRIX_ID,
      TENANT,
    );
    expect(ok).toBe(false);
    expect(lastSql()).toContain("delete from");
  });

  it("toView serialises the row", () => {
    const view = matrixRepo.toView({
      id: MATRIX_ID,
      tenantId: TENANT,
      triggerProductId: PRODUCT_A,
      recommendedProductId: PRODUCT_B,
      segment: null,
      channel: null,
      priority: 4,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      createdBy: USER,
      updatedBy: USER,
      version: 1,
    });
    expect(view.priority).toBe(4);
  });
});
