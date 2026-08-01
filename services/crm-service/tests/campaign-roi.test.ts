/**
 * Campaign responses / cost / ROI tests (MK-004).
 * The ROI maths is integer basis points computed with BigInt; the zero-cost case
 * must not divide by zero, and large values must not lose precision.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import {
  computeRoi,
  computeNetMinor,
  costPerResponse,
  formatBasisPoints,
  ROI_UNDEFINED,
  BPS_SCALE,
} from "../src/modules/dashboard/roi-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000067";
const ACTOR = "cccccccc-3333-4000-8000-000000000067";
const CAMPAIGN_A = "33333333-6700-4000-8000-000000000001";
const CAMPAIGN_B = "33333333-6700-4000-8000-000000000002";
const CAMPAIGN_FREE = "33333333-6700-4000-8000-000000000003";
const NONEXIST = "ffffffff-ffff-4000-8000-000000000067";

/** 2^53 + 1 in paise — beyond exact float representation. */
const ABOVE_2_53 = "9007199254740993";

function token(roles = ["crm_admin"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-roi" }, SECRET);
}

function headers(roles = ["crm_admin"]) {
  return { authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT };
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.campaign_performance WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(cleanup);

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function upsert(campaignId: string, payload: Record<string, unknown>, roles = ["crm_admin"]) {
  const app = await buildApp();
  const res = await app.inject({
    method: "PUT",
    url: `/v1/crm/campaigns/${campaignId}/performance`,
    headers: headers(roles),
    payload,
  });
  await app.close();
  return res;
}

describe("roi-domain — computeRoi (pure)", () => {
  it("returns 10000 bp (100%) when revenue doubles cost", () => {
    expect(computeRoi(100_000n, 200_000n)).toBe(10_000n);
    expect(formatBasisPoints(10_000n)).toBe("100.00");
  });

  it("returns 0 bp at break-even", () => {
    expect(computeRoi(50_000n, 50_000n)).toBe(0n);
  });

  it("returns negative bp for a loss-making campaign", () => {
    // Spent 100000, earned 25000 → -75%.
    expect(computeRoi(100_000n, 25_000n)).toBe(-7_500n);
    expect(formatBasisPoints(-7_500n)).toBe("-75.00");
  });

  it("returns -10000 bp when a campaign earns nothing", () => {
    expect(computeRoi(100_000n, 0n)).toBe(-10_000n);
  });

  it("does NOT divide by zero when cost is zero — returns the documented sentinel", () => {
    expect(() => computeRoi(0n, 1_000n)).not.toThrow();
    expect(computeRoi(0n, 1_000n)).toBe(ROI_UNDEFINED);
    expect(computeRoi(0n, 0n)).toBe(ROI_UNDEFINED);
    expect(computeRoi(0n, 1_000n)).toBeNull();
    expect(formatBasisPoints(ROI_UNDEFINED)).toBeNull();
  });

  it("stays exact for values far above 2^53", () => {
    const cost = BigInt(ABOVE_2_53);
    const revenue = cost * 3n;
    expect(computeRoi(cost, revenue)).toBe(20_000n);
    expect(computeNetMinor(cost, revenue)).toBe(cost * 2n);
    // Same computation in floating point would drift; BigInt does not.
    expect(computeNetMinor(cost, revenue).toString()).toBe("18014398509481986");
  });

  it("truncates toward zero rather than rounding up", () => {
    // (10 - 3) * 10000 / 3 = 23333.33 → 23333
    expect(computeRoi(3n, 10n)).toBe(23_333n);
    expect(BPS_SCALE).toBe(10_000n);
  });

  it("computes cost per response and guards zero responses", () => {
    expect(costPerResponse(100_000n, 4)).toBe(25_000n);
    expect(costPerResponse(100_000n, 3)).toBe(33_333n);
    expect(costPerResponse(100_000n, 0)).toBeNull();
    expect(costPerResponse(100_000n, -1)).toBeNull();
    expect(costPerResponse(100_000n, 1.5)).toBeNull();
  });

  it("formats basis points with two decimals", () => {
    expect(formatBasisPoints(12_345n)).toBe("123.45");
    expect(formatBasisPoints(5n)).toBe("0.05");
    expect(formatBasisPoints(-5n)).toBe("-0.05");
  });
});

describe("PUT /v1/crm/campaigns/:id/performance", () => {
  it("inserts a period → 200 with ROI in basis points", async () => {
    const res = await upsert(CAMPAIGN_A, {
      responses: 400,
      costMinor: "100000",
      revenueMinor: "250000",
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
    });

    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.costMinor).toBe("100000");
    expect(d.revenueMinor).toBe("250000");
    expect(d.netMinor).toBe("150000");
    expect(d.roiBasisPoints).toBe("15000");
    expect(d.roiPercent).toBe("150.00");
    expect(d.costPerResponseMinor).toBe("250");
    expect(d.version).toBe(1);
  });

  it("upserts the same period instead of double-counting", async () => {
    const second = await upsert(CAMPAIGN_A, {
      responses: 500,
      costMinor: "120000",
      revenueMinor: "300000",
      periodStart: "2026-01-01",
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().data.version).toBe(2);

    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx`
        SELECT count(*)::int AS count FROM crm.campaign_performance
        WHERE tenant_id = ${TENANT} AND campaign_id = ${CAMPAIGN_A}
      `;
    });
    expect(rows[0]?.count).toBe(1);
  });

  it("keeps money above 2^53 exact through the round-trip", async () => {
    const res = await upsert(CAMPAIGN_B, {
      responses: 10,
      costMinor: ABOVE_2_53,
      revenueMinor: ABOVE_2_53,
      periodStart: "2026-04-01",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.costMinor).toBe(ABOVE_2_53);
    expect(res.json().data.roiBasisPoints).toBe("0");
  });

  it("records a zero-cost campaign without dividing by zero", async () => {
    const res = await upsert(CAMPAIGN_FREE, {
      responses: 25,
      costMinor: "0",
      revenueMinor: "500000",
      periodStart: "2026-05-01",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.roiBasisPoints).toBeNull();
    expect(res.json().data.roiPercent).toBeNull();
    expect(res.json().data.costPerResponseMinor).toBe("0");
  });

  it("rejects a float cost → 400", async () => {
    const res = await upsert(CAMPAIGN_A, {
      costMinor: "1000.50",
      revenueMinor: "0",
      periodStart: "2026-06-01",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing periodStart → 400", async () => {
    const res = await upsert(CAMPAIGN_A, { costMinor: "1", revenueMinor: "1" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a periodEnd before periodStart → 400", async () => {
    const res = await upsert(CAMPAIGN_A, {
      costMinor: "1",
      revenueMinor: "1",
      periodStart: "2026-07-01",
      periodEnd: "2026-06-01",
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: `/v1/crm/campaigns/${CAMPAIGN_A}/performance`,
      payload: { costMinor: "1", revenueMinor: "1", periodStart: "2026-08-01" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a plain crm_user (writing spend is an admin act)", async () => {
    const res = await upsert(
      CAMPAIGN_A,
      { costMinor: "1", revenueMinor: "1", periodStart: "2026-08-01" },
      ["crm_user"],
    );
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/campaigns/:id/roi", () => {
  it("aggregates all periods for a campaign", async () => {
    await upsert(CAMPAIGN_A, {
      responses: 100,
      costMinor: "80000",
      revenueMinor: "100000",
      periodStart: "2026-09-01",
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/campaigns/${CAMPAIGN_A}/roi`,
      headers: headers(["crm_user"]),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    // 120000 + 80000 spent, 300000 + 100000 earned.
    expect(d.costMinor).toBe("200000");
    expect(d.revenueMinor).toBe("400000");
    expect(d.roiBasisPoints).toBe("10000");
    expect(d.responses).toBe(600);
    expect(d.periods).toHaveLength(2);
  });

  it("returns null ROI for a zero-cost campaign", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/campaigns/${CAMPAIGN_FREE}/roi`,
      headers: headers(["crm_user"]),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.roiBasisPoints).toBeNull();
  });

  it("returns 404 when no performance data exists", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/campaigns/${NONEXIST}/roi`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a non-uuid campaign id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/campaigns/not-a-uuid/roi",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/crm/campaigns/${CAMPAIGN_A}/roi` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for an unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/campaigns/${CAMPAIGN_A}/roi`,
      headers: headers(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/campaigns/roi-summary", () => {
  it("returns one row per campaign with the list envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/campaigns/roi-summary",
      headers: headers(["crm_user"]),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.total).toBe(3);
    const free = body.data.find((r: { campaignId: string }) => r.campaignId === CAMPAIGN_FREE);
    expect(free.roiBasisPoints).toBeNull();
    const big = body.data.find((r: { campaignId: string }) => r.campaignId === CAMPAIGN_B);
    expect(big.costMinor).toBe(ABOVE_2_53);
  });

  it("honours pagination", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/campaigns/roi-summary?page=1&limit=1",
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().meta.pageSize).toBe(1);
  });

  it("rejects limit above the clamp → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/campaigns/roi-summary?limit=1000",
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/crm/campaigns/roi-summary" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
