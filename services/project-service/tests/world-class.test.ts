/**
 * project-service — world-class routes integration suite
 *
 * Exercises the hardened world-class endpoints (risks, EVM, RA-bills,
 * time-extensions, penalties) end-to-end via Fastify `inject`:
 *   - parent-tenant isolation  → cross-tenant parent project returns 404
 *   - SoD                      → creator may not approve their own RA-bill / time-extension (403)
 *   - state-predicate guards   → approving an already-approved item returns 409
 *   - bigint money             → EVM EAC + penalty totals stay exact in paise
 *   - Zod validation           → bad body returns 400
 *
 * Two distinct HS256 actors (different `sub`) are used so SoD creator≠approver
 * can be asserted (the x-internal bypass always yields one fixed actorId).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { projectProjects } from "../src/modules/project/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "bbbbbbbb-1111-4000-8000-0000000000a1";
const TENANT_B = "bbbbbbbb-1111-4000-8000-0000000000b2";
const PROJECT_A = "cccccccc-2222-4000-8000-0000000000a1"; // owned by TENANT_A
const PROJECT_B = "cccccccc-2222-4000-8000-0000000000b2"; // owned by TENANT_B
const USER_1 = "dddddddd-3333-4000-8000-000000000001";
const USER_2 = "dddddddd-3333-4000-8000-000000000002";

function token(opts: { sub: string; tid: string; roles?: string[] }): string {
  return signToken(
    { sub: opts.sub, tid: opts.tid, roles: opts.roles ?? ["project_manager"], sid: "sess-wc" },
    SECRET,
  );
}

async function seedProject(id: string, tenantId: string): Promise<void> {
  // Wrapped in runWithTenant + db.transaction() so wrapWithTenantGuc injects
  // app.tenant_id before this write — a bare db.insert() runs with no RLS
  // GUC set and violates the tenant_isolation policy under FORCE RLS.
  await runWithTenant(tenantId, () => db.transaction((tx) => tx
    .insert(projectProjects)
    .values({
      id,
      tenantId,
      code: `WC-${id.slice(0, 8)}`,
      name: "WC test project",
      createdBy: USER_1,
      updatedBy: USER_1,
    })
    .onConflictDoNothing()));
}

async function wipe(): Promise<void> {
  // Wrapped in runWithTenant + db.transaction() so wrapWithTenantGuc injects
  // app.tenant_id before these writes — bare sqlClient/db calls run with no
  // RLS GUC set and are silently rejected/scoped to zero rows under FORCE RLS.
  for (const t of [TENANT_A, TENANT_B]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM project.project_ra_bills WHERE tenant_id = ${t}`);
      await tx.execute(sql`DELETE FROM project.project_time_extensions WHERE tenant_id = ${t}`);
      await tx.execute(sql`DELETE FROM project.project_risks WHERE tenant_id = ${t}`);
      await tx.execute(sql`DELETE FROM project.project_evm WHERE tenant_id = ${t}`);
      await tx.execute(sql`DELETE FROM project.project_penalties WHERE tenant_id = ${t}`);
      await tx.delete(projectProjects).where(eq(projectProjects.tenantId, t));
    }));
  }
}

let app: FastifyInstance;

beforeAll(async () => {
  await wipe();
  await seedProject(PROJECT_A, TENANT_A);
  await seedProject(PROJECT_B, TENANT_B);
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await wipe();
  await sqlClient.end();
});

// ── 1. Parent-tenant isolation ───────────────────────────────────────────────

describe("parent-tenant isolation", () => {
  it("creating a risk under a project owned by another tenant → 404", async () => {
    // Caller authenticated for TENANT_A but targets PROJECT_B (TENANT_B's).
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_B}/risks`,
      headers: { authorization: `Bearer ${token({ sub: USER_1, tid: TENANT_A })}` },
      payload: { title: "cross-tenant risk", category: "technical" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("creating a risk under own-tenant project → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/risks`,
      headers: { authorization: `Bearer ${token({ sub: USER_1, tid: TENANT_A })}` },
      payload: { title: "real risk", category: "financial", probability: "high", impact: "high" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBeDefined();
  });
});

// ── 2. Risk register read + risk-score computation ───────────────────────────

describe("risk register", () => {
  it("GET risks returns the previously created risk with computed risk_score", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_A}/risks`,
      headers: { authorization: `Bearer ${token({ sub: USER_2, tid: TENANT_A, roles: ["audit_officer"] })}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ risk_score: number; probability: string; impact: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const highHigh = rows.find((r) => r.probability === "high" && r.impact === "high");
    expect(highHigh?.risk_score).toBe(9); // high(3) * high(3)
  });
});

// ── 3. EVM compute — bigint money ────────────────────────────────────────────

describe("EVM compute", () => {
  it("computes CPI/SPI and exact integer-paise EAC/ETC/VAC", async () => {
    // PV=1_000_000  EV=500_000  AC=400_000  BAC=1_000_000
    // CPI = EV/AC = 1.25 ; SPI = EV/PV = 0.5
    // EAC = (BAC*AC)/EV = (1_000_000 * 400_000)/500_000 = 800_000
    // ETC = EAC-AC = 400_000 ; VAC = BAC-EAC = 200_000
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/evm/compute`,
      headers: { authorization: `Bearer ${token({ sub: USER_1, tid: TENANT_A })}` },
      payload: {
        period: "2026-06",
        plannedValueMinor: 1_000_000,
        earnedValueMinor: 500_000,
        actualCostMinor: 400_000,
        budgetAtCompletionMinor: 1_000_000,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.cpi).toBeCloseTo(1.25, 6);
    expect(body.spi).toBeCloseTo(0.5, 6);
    expect(body.eacMinor).toBe("800000");
    expect(body.etcMinor).toBe("400000");
    expect(body.vacMinor).toBe("200000");
  });
});

// ── 4. RA-bill SoD + state guard ─────────────────────────────────────────────

describe("RA-bill approval — SoD + state guard", () => {
  let billId: string;

  it("USER_1 submits an RA-bill → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/ra-bills`,
      headers: { authorization: `Bearer ${token({ sub: USER_1, tid: TENANT_A })}` },
      payload: {
        contractorId: "eeeeeeee-4444-4000-8000-000000000001",
        billNo: "RA-1",
        billDate: "2026-06-01",
        grossAmountMinor: 1_000_000,
        deductionsMinor: 50_000,
        netAmountMinor: 950_000,
        cumulativeMinor: 950_000,
      },
    });
    expect(res.statusCode).toBe(201);
    billId = res.json().id;
    expect(billId).toBeDefined();
  });

  it("submitter (USER_1) approving own bill → 403 SOD_VIOLATION", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/ra-bills/${billId}/approve`,
      headers: { authorization: `Bearer ${token({ sub: USER_1, tid: TENANT_A })}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SOD_VIOLATION");
  });

  it("different approver (USER_2) approving → 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/ra-bills/${billId}/approve`,
      headers: { authorization: `Bearer ${token({ sub: USER_2, tid: TENANT_A })}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("re-approving an already-approved bill → 409 CONFLICT (state guard)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/ra-bills/${billId}/approve`,
      headers: { authorization: `Bearer ${token({ sub: USER_2, tid: TENANT_A })}` },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CONFLICT");
  });

  it("approving an unknown bill id → 404", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/ra-bills/00000000-0000-4000-8000-000000000000/approve`,
      headers: { authorization: `Bearer ${token({ sub: USER_2, tid: TENANT_A })}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── 5. Time-extension SoD + state guard ──────────────────────────────────────

describe("time-extension approval — SoD + state guard", () => {
  let extId: string;

  it("USER_1 requests a time extension → 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/time-extensions`,
      headers: { authorization: `Bearer ${token({ sub: USER_1, tid: TENANT_A })}` },
      payload: {
        originalEndDate: "2026-06-30",
        extendedEndDate: "2026-09-30",
        extensionDays: 92,
        reason: "monsoon delay",
        penaltyApplicable: false,
      },
    });
    expect(res.statusCode).toBe(201);
    extId = res.json().id;
  });

  it("requester (USER_1) approving own extension → 403 SOD_VIOLATION", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/time-extensions/${extId}/approve`,
      headers: { authorization: `Bearer ${token({ sub: USER_1, tid: TENANT_A })}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SOD_VIOLATION");
  });

  it("different approver (USER_2) approving → 200, then re-approve → 409", async () => {
    const ok = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/time-extensions/${extId}/approve`,
      headers: { authorization: `Bearer ${token({ sub: USER_2, tid: TENANT_A })}` },
    });
    expect(ok.statusCode).toBe(200);

    const again = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/time-extensions/${extId}/approve`,
      headers: { authorization: `Bearer ${token({ sub: USER_2, tid: TENANT_A })}` },
    });
    expect(again.statusCode).toBe(409);
  });
});

// ── 6. Penalties — bigint total = days * ratePerDay ──────────────────────────

describe("penalties", () => {
  it("levies a penalty with exact bigint total", async () => {
    // 30 days * 1234 paise/day = 37020 paise
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/penalties`,
      headers: { authorization: `Bearer ${token({ sub: USER_1, tid: TENANT_A })}` },
      payload: {
        penaltyType: "delay",
        fromDate: "2026-07-01",
        toDate: "2026-07-30",
        days: 30,
        ratePerDayMinor: 1234,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().totalMinor).toBe("37020");
  });
});

// ── 7. Authz + validation ────────────────────────────────────────────────────

describe("authz + validation on world-class routes", () => {
  it("wrong role (citizen) creating a risk → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/risks`,
      headers: { authorization: `Bearer ${token({ sub: USER_1, tid: TENANT_A, roles: ["citizen"] })}` },
      payload: { title: "x" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("invalid body (missing title) → 400 VALIDATION_FAILED", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_A}/risks`,
      headers: { authorization: `Bearer ${token({ sub: USER_1, tid: TENANT_A })}` },
      payload: { category: "technical" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("unauthenticated → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_A}/risks`,
    });
    expect(res.statusCode).toBe(401);
  });
});
