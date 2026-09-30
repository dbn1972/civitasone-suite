/**
 * GAP-HR-PROMOTION-01/06: GET /v1/hrms/lifecycle/promotions spreads the raw
 * hrms_promotions row (`...r`) into its reply, which still carried
 * newBasicMinor as a plain JS bigint (lifecycle/schema.ts:
 * bigint({mode:"bigint"})) -- and this repo has no global BigInt JSON
 * serializer (grep for "BigInt.prototype.toJSON" across services/
 * hrms-service/src and packages finds none). Fastify's default reply
 * serializer has no bigint support either, so a promotion row that actually
 * recorded a new basic pay -- the core data the /hr/promotion page exists to
 * show -- would throw `TypeError: Do not know how to serialize a BigInt`
 * and 500 the whole list for that tenant. Regression-tests the fix
 * (lifecycle/routes.ts overrides newBasicMinor to a string after the
 * spread) against a real Postgres bigint column, not a mock.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../shared/db.js";
import { buildApp } from "../app.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../modules/employee/schema.js";
import { hrmsPromotions } from "../modules/lifecycle/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const deptId = randomUUID();
const fromDesigId = randomUUID();
const toDesigId = randomUUID();
const empId = randomUUID();

const hrToken = signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET);

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: "PNM1", name: "Pay Test Dept", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: fromDesigId, tenantId: TENANT, code: "PNMF", name: "Section Officer", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: toDesigId, tenantId: TENANT, code: "PNMT", name: "Under Secretary", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsEmployees).values({
      id: empId, tenantId: TENANT, employeeNo: "PNM-1", fullName: "Pay Serialization Candidate",
      departmentId: deptId, designationId: fromDesigId, dateOfJoining: "2015-01-01",
      status: "confirmed", employeeType: "permanent", createdBy: ACTOR, updatedBy: ACTOR,
    });
    // The exact column this bug is about: a real bigint (paise), not a number.
    await tx.insert(hrmsPromotions).values({
      tenantId: TENANT, employeeId: empId, fromDesigId, toDesigId,
      effectiveDate: "2026-04-01", status: "completed",
      newBasicMinor: 4_550_000n,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsPromotions).where(eq(hrmsPromotions.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  }));
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/lifecycle/promotions — GAP-HR-PROMOTION-01/06", () => {
  it("does not 500 on a row with a non-null newBasicMinor, and returns it as a string", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/lifecycle/promotions", headers: { authorization: `Bearer ${hrToken}` } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { data: Array<{ employeeId: string; newBasicMinor: unknown }> };
    const row = body.data.find((d) => d.employeeId === empId);
    expect(row).toBeDefined();
    expect(typeof row?.newBasicMinor).toBe("string");
    expect(row?.newBasicMinor).toBe("4550000");
  });
});
