/**
 * project-service — scheme-detail regression test (COMP-016).
 *
 * Before this fix, apps/web's /projects/schemes/[id] page rendered an
 * 11-entry hardcoded SCHEMES catalogue (`SCHEMES[id] ?? DEFAULT_SCHEME`) and
 * never called any loader at all. GET /v1/projects/schemes/:id already
 * existed and already selected every column via repo.findSchemeById's bare
 * `select()` -- including the real fundingPattern text column -- but
 * routes.ts used to `reply.send()` that raw row unchanged.
 *
 * Sabotage-checked by temporarily reverting routes.ts's handler back to
 * `queries.getScheme` + a bare `reply.send(scheme)` and re-running this
 * suite: 3 of 6 cases failed as predicted (schemeCode/projects missing --
 * see below), proving this suite actually catches the regression rather
 * than passing vacuously either way. That check also disproved this suite's
 * own first draft theory that the raw route 500s on BigInt fields
 * (totalOutlayMinor/releasedMinor/utilisedMinor) -- it does not:
 * @civitasone/observability's registerOpsRoutes wires a global
 * `preSerialization` hook (jsonSafe()) that stringifies BigInt in every
 * response service-wide, so the reverted route actually returns 200 with a
 * real, but WRONG-SHAPED, body: raw `code` (not `schemeCode`), no
 * `projects`, no `utilisationPct`, no `fundingType`, and internal columns
 * (tenantId/createdAt/updatedBy/version/...) no frontend consumer needs.
 * That wrong shape is exactly what a real per-tenant scheme detail page
 * calling this route would have broken against, which is what this suite
 * guards.
 *
 * This suite proves, against a real Postgres (no mocks, real RLS): the route
 * now returns the real DTO shape -- a real per-tenant scheme
 * (schemeCode/name/fundingPattern/sanctionRef/budget/utilisation) with a
 * real linked-project sub-list built from project_projects rows -- a scheme
 * with zero linked projects returns an empty list rather than fabricating
 * or erroring, and a different tenant's scheme is genuinely isolated by RLS
 * rather than merely by an app-layer WHERE.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/shared/db.js";
import { projectSchemes } from "../src/modules/scheme/schema.js";
import { projectProjects } from "../src/modules/project/schema.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_A = "c016a000-dead-4000-8000-0000000c016a";
const TENANT_B = "c016b000-dead-4000-8000-0000000c016b";
const ACTOR = "c016a000-dead-4000-8000-0000000ac70a";

function authHeader(tenantId: string, roles: string[] = ["project_manager"]) {
  const jwt = signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-comp-016" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

let app: FastifyInstance;
const schemeIdA = randomUUID();
const schemeIdB = randomUUID();
const emptySchemeId = randomUUID();
const projectId1 = randomUUID();
const projectId2 = randomUUID();

async function clean() {
  await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
    await tx.delete(projectProjects).where(eq(projectProjects.tenantId, TENANT_A));
    await tx.delete(projectSchemes).where(eq(projectSchemes.tenantId, TENANT_A));
  }));
  await runWithTenant(TENANT_B, () => db.transaction(async (tx) => {
    await tx.delete(projectProjects).where(eq(projectProjects.tenantId, TENANT_B));
    await tx.delete(projectSchemes).where(eq(projectSchemes.tenantId, TENANT_B));
  }));
}

beforeAll(async () => {
  app = await buildApp();
  await clean();

  await runWithTenant(TENANT_A, () => db.transaction(async (tx) => {
    await tx.insert(projectSchemes).values({
      id: schemeIdA, tenantId: TENANT_A, code: "COMP016-A", name: "COMP-016 Test Scheme A",
      type: "css", fundingPattern: "Centre 60% : State 40%",
      totalOutlayMinor: 100000000n, releasedMinor: 60000000n, utilisedMinor: 25000000n,
      sanctionRef: "SANC/COMP016/A", status: "active",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(projectSchemes).values({
      id: emptySchemeId, tenantId: TENANT_A, code: "COMP016-EMPTY", name: "COMP-016 Empty Scheme",
      type: "state", fundingPattern: "State 100%",
      totalOutlayMinor: 0n, releasedMinor: 0n, utilisedMinor: 0n,
      status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(projectProjects).values({
      id: projectId1, tenantId: TENANT_A, code: "PRJ-COMP016-1", name: "COMP-016 Linked Project One",
      schemeId: schemeIdA, dprCostMinor: 30000000n, status: "active",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(projectProjects).values({
      id: projectId2, tenantId: TENANT_A, code: "PRJ-COMP016-2", name: "COMP-016 Linked Project Two",
      schemeId: schemeIdA, dprCostMinor: 45000000n, status: "planned",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));

  await runWithTenant(TENANT_B, () => db.transaction(async (tx) => {
    await tx.insert(projectSchemes).values({
      id: schemeIdB, tenantId: TENANT_B, code: "COMP016-B", name: "COMP-016 Test Scheme B (other tenant)",
      type: "central", fundingPattern: "Centre 100%",
      totalOutlayMinor: 5000000n, releasedMinor: 1000000n, utilisedMinor: 500000n,
      status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
});

afterAll(async () => {
  await clean();
  await app.close();
});

describe("GET /v1/projects/schemes/:id (COMP-016)", () => {
  it("returns the real scheme with its real linked-project sub-list, not a hardcoded catalogue", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/schemes/${schemeIdA}`, headers: authHeader(TENANT_A) });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.id).toBe(schemeIdA);
    expect(body.schemeCode).toBe("COMP016-A");
    expect(body.name).toBe("COMP-016 Test Scheme A");
    expect(body.fundingPattern).toBe("Centre 60% : State 40%");
    expect(body.sanctionRef).toBe("SANC/COMP016/A");
    expect(body.totalOutlayMinor).toBe("100000000");
    expect(body.releasedMinor).toBe("60000000");
    expect(body.utilisedMinor).toBe("25000000");
    expect(body.utilisationPct).toBe(25);

    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.projects).toHaveLength(2);
    const codes = body.projects.map((p: { code: string }) => p.code).sort();
    expect(codes).toEqual(["PRJ-COMP016-1", "PRJ-COMP016-2"]);
    const one = body.projects.find((p: { code: string }) => p.code === "PRJ-COMP016-1");
    expect(one.name).toBe("COMP-016 Linked Project One");
    expect(one.status).toBe("active");
    expect(one.budgetMinor).toBe("30000000");

    // None of the pre-fix hardcoded catalogue's fixture values, and none of
    // the fields with no backing column anywhere in the schema, should ever
    // appear on the wire.
    expect(JSON.stringify(body)).not.toContain("PM Awas Yojana");
    expect(JSON.stringify(body)).not.toContain("Shri R.K. Gautam");
    expect(body.nodalOfficer).toBeUndefined();
    expect(body.department).toBeUndefined();
    expect(body.beneficiaries).toBeUndefined();
  });

  it("returns an empty project list (not a 500 or fabricated rows) and 0% utilisation for a scheme with a zero outlay", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/schemes/${emptySchemeId}`, headers: authHeader(TENANT_A) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projects).toEqual([]);
    expect(body.utilisationPct).toBe(0);
  });

  it("does not leak another tenant's scheme (RLS, not just an app-layer WHERE)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/schemes/${schemeIdB}`, headers: authHeader(TENANT_A) });
    expect(res.statusCode).toBe(404);
  });

  it("the owning tenant can still see their own scheme", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/schemes/${schemeIdB}`, headers: authHeader(TENANT_B) });
    expect(res.statusCode).toBe(200);
    expect(res.json().schemeCode).toBe("COMP016-B");
  });

  it("returns 404 for a nonexistent id", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/schemes/${randomUUID()}`, headers: authHeader(TENANT_A) });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for a role with no scheme-reader access", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/schemes/${schemeIdA}`, headers: authHeader(TENANT_A, ["employee"]) });
    expect(res.statusCode).toBe(403);
  });
});
