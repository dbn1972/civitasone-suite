/**
 * GAP-HR-PROMOTION-01: /hr/promotion now reads ONE source -- the enriched,
 * un-prefixed GET /v1/hrms/promotions (lifecycle/m7-list-routes.ts) -- instead
 * of the raw lifecycle list with this one as an empty-only fallback. The page's
 * table columns are keyed on this route's shape (employee, department,
 * fromGrade, toGrade, orderNo), so as soon as a promotion existed the table's
 * name / grade / order cells came out blank. This suite pins the contract the
 * page now depends on, against a real Postgres bigint column:
 *   - names and grades are resolved (no UUIDs in any of those cells);
 *   - newBasicMinor is a decimal STRING (Fastify cannot serialise a bigint, and
 *     this service has no global serializer), null when none was recorded;
 *   - currency / orderRef / createdAt are carried so nothing the raw list had
 *     is lost;
 *   - newest first, capped at 500 with `hasMore` -- and the cap drops the OLDEST;
 *   - strictly tenant-scoped and HR-role-gated.
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

const SECRET = process.env.JWT_SECRET as string;
const ACTOR = randomUUID();

interface Seed { tenant: string; dept: string; fromDesig: string; toDesig: string; emp: string }
const mkSeed = (): Seed => ({ tenant: randomUUID(), dept: randomUUID(), fromDesig: randomUUID(), toDesig: randomUUID(), emp: randomUUID() });
const A = mkSeed();
const B = mkSeed(); // another tenant -- must never show up for A
const BIG = mkSeed(); // 501 promotions, for the cap

const token = (tenant: string, roles = ["hr_admin"]) => signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET);

async function seedTenant(s: Seed, label: string) {
  await runWithTenant(s.tenant, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: s.dept, tenantId: s.tenant, code: `PL-${label}`, name: `${label} Department`, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: s.fromDesig, tenantId: s.tenant, code: `PLF-${label}`, name: `${label} Section Officer`, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: s.toDesig, tenantId: s.tenant, code: `PLT-${label}`, name: `${label} Under Secretary`, createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsEmployees).values({
      id: s.emp, tenantId: s.tenant, employeeNo: `PL-${label}-1`, fullName: `${label} Promotee`,
      departmentId: s.dept, designationId: s.fromDesig, dateOfJoining: "2015-01-01",
      status: "confirmed", employeeType: "permanent", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

const day = (n: number) => new Date(Date.UTC(2020, 0, 1 + n)).toISOString().slice(0, 10);

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await seedTenant(A, "A");
  await seedTenant(B, "B");
  await seedTenant(BIG, "BIG");
  await runWithTenant(A.tenant, () => db.transaction(async (tx) => {
    await tx.insert(hrmsPromotions).values([
      // oldest: no new basic recorded, no order ref
      { tenantId: A.tenant, employeeId: A.emp, fromDesigId: A.fromDesig, toDesigId: A.toDesig, effectiveDate: "2024-04-01", status: "completed", createdBy: ACTOR, updatedBy: ACTOR },
      // newest: a real bigint (paise) + an order reference
      { tenantId: A.tenant, employeeId: A.emp, fromDesigId: A.fromDesig, toDesigId: A.toDesig, effectiveDate: "2026-04-01", status: "pending_effective", orderRef: "PROMO/2026/014", newBasicMinor: 4_550_000n, createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  }));
  await runWithTenant(B.tenant, () => db.transaction(async (tx) => {
    await tx.insert(hrmsPromotions).values({ tenantId: B.tenant, employeeId: B.emp, fromDesigId: B.fromDesig, toDesigId: B.toDesig, effectiveDate: "2025-01-01", status: "completed", createdBy: ACTOR, updatedBy: ACTOR });
  }));
  await runWithTenant(BIG.tenant, () => db.transaction(async (tx) => {
    await tx.insert(hrmsPromotions).values(
      Array.from({ length: 501 }, (_, i) => ({
        tenantId: BIG.tenant, employeeId: BIG.emp, fromDesigId: BIG.fromDesig, toDesigId: BIG.toDesig,
        effectiveDate: day(i), status: "completed", orderRef: `BIG-${i}`, createdBy: ACTOR, updatedBy: ACTOR,
      })),
    );
  }));
}, 60_000);

afterAll(async () => {
  for (const s of [A, B, BIG]) {
    await runWithTenant(s.tenant, () => db.transaction(async (tx) => {
      await tx.delete(hrmsPromotions).where(eq(hrmsPromotions.tenantId, s.tenant));
      await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, s.tenant));
      await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, s.tenant));
      await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, s.tenant));
    }));
  }
  await app.close();
  await sqlClient.end();
});

type Row = Record<string, unknown>;
async function list(tenant: string, roles?: string[]): Promise<{ status: number; body: { data: Row[]; hasMore?: boolean } }> {
  const r = await app.inject({ method: "GET", url: "/v1/hrms/promotions", headers: { authorization: `Bearer ${token(tenant, roles)}` } });
  return { status: r.statusCode, body: r.statusCode === 200 ? JSON.parse(r.body) : { data: [] } };
}

describe("GET /v1/hrms/promotions (the /hr/promotion page's single source) — GAP-HR-PROMOTION-01", () => {
  it("resolves names and grades, so the table has no blank cells and no UUIDs", async () => {
    const { status, body } = await list(A.tenant);
    expect(status).toBe(200);
    expect(body.data).toHaveLength(2);
    for (const row of body.data) {
      expect(row).toMatchObject({
        employee: "A Promotee",
        department: "A Department",
        fromGrade: "A Section Officer",
        toGrade: "A Under Secretary",
      });
      expect(JSON.stringify(row)).not.toContain(A.emp);
      expect(JSON.stringify(row)).not.toContain(A.toDesig);
    }
  });

  it("returns newBasicMinor as a decimal string when recorded, null otherwise (no bigint, no 500)", async () => {
    const { body } = await list(A.tenant);
    const withPay = body.data.find((r) => r.status === "pending_effective") as Row;
    const without = body.data.find((r) => r.status === "completed") as Row;
    expect(withPay.newBasicMinor).toBe("4550000");
    expect(typeof withPay.newBasicMinor).toBe("string");
    expect(without.newBasicMinor).toBeNull();
  });

  it("carries orderRef, currency and createdAt, with orderNo kept as the table's column", async () => {
    const { body } = await list(A.tenant);
    const withPay = body.data.find((r) => r.status === "pending_effective") as Row;
    expect(withPay).toMatchObject({ orderRef: "PROMO/2026/014", orderNo: "PROMO/2026/014", currency: "INR" });
    expect(Number.isNaN(Date.parse(String(withPay.createdAt)))).toBe(false);
    const without = body.data.find((r) => r.status === "completed") as Row;
    expect(without.orderRef).toBeNull();
    expect(without.orderNo).toBe("—");
  });

  it("lists the newest promotion first", async () => {
    const { body } = await list(A.tenant);
    expect(body.data.map((r) => r.effectiveDate)).toEqual(["2026-04-01", "2024-04-01"]);
  });

  it("never returns another tenant's promotions", async () => {
    const { body } = await list(A.tenant);
    expect(JSON.stringify(body)).not.toContain("B Promotee");
    const other = await list(B.tenant);
    expect(other.body.data).toHaveLength(1);
    expect(other.body.data[0]?.employee).toBe("B Promotee");
  });

  it("caps at 500 rows, reports hasMore, and the cap drops the OLDEST promotion", async () => {
    const { body } = await list(BIG.tenant);
    expect(body.data).toHaveLength(500);
    expect(body.hasMore).toBe(true);
    expect(body.data[0]?.effectiveDate).toBe(day(500)); // the newest of 501
    expect(body.data.some((r) => r.effectiveDate === day(0))).toBe(false); // the oldest is the one cut
    expect(typeof body.data[0]?.orderNo).toBe("string");
  });

  it("does not report hasMore for a short list", async () => {
    expect((await list(A.tenant)).body.hasMore).toBe(false);
  });

  it("stays HR-role-gated", async () => {
    expect((await list(A.tenant, ["manager"])).status).toBe(403);
    expect((await list(A.tenant, ["employee"])).status).toBe(403);
  });
});
