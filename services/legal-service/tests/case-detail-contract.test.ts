/**
 * GET /v1/legal/cases/:id — real-DB route test + web-schema contract.
 *
 * Regression: the route used to return the raw legal_cases row, which the web
 * loader (LegalCaseDetailSchema) rejected for every real case (no type /
 * filedDate, status "pending" not in the enum, nulls, no hearings/orders), so
 * /legal/cases/[id] always showed the retry error. These tests feed the REAL
 * service response into the REAL web schema so a drift fails here.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { LegalCaseDetailSchema, LegalDashboardSchema } from "@civitasone/schemas/web";
import { db, sqlClient } from "../src/shared/db.js";
import { cache } from "../src/shared/infra.js";
import { legalCases, legalCaseTypes, legalParties } from "../src/modules/cases/schema.js";
import { legalHearings, legalOrders } from "../src/modules/hearings/schema.js";
import * as caseRepo from "../src/modules/cases/repo.js";
import * as caseQueries from "../src/modules/cases/queries.js";
import * as opinionCommands from "../src/modules/opinions/commands.js";
import * as opinionQueries from "../src/modules/opinions/queries.js";
import { getDashboard } from "../src/modules/dashboard/queries.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-0000000000d1";
const OTHER = "11111111-aaaa-4000-8000-0000000000d2";
const ACTOR = "00000000-aaaa-4000-8000-0000000000d1";
const TYPE_ID = "44444444-bbbb-4000-8000-0000000000d1";
const FULL = "22222222-bbbb-4000-8000-0000000000d1";
const BARE = "22222222-bbbb-4000-8000-0000000000d2";
const FOREIGN = "22222222-bbbb-4000-8000-0000000000d3";

const token = (roles: string[], tid = TENANT) =>
  signToken({ sub: ACTOR, tid, roles, sid: "sess-test" }, JWT_SECRET, 3600);
const get = async (id: string, roles = ["legal_officer"], tid = TENANT) => {
  const { buildApp } = await import("../src/app.js");
  const app = await buildApp();
  try {
    return await app.inject({
      method: "GET", url: `/v1/legal/cases/${id}`,
      headers: { authorization: `Bearer ${token(roles, tid)}`, "x-tenant-id": tid },
    });
  } finally { await app.close(); }
};

async function wipe(tenant: string) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(legalOrders).where(eq(legalOrders.tenantId, tenant));
    await tx.delete(legalHearings).where(eq(legalHearings.tenantId, tenant));
    await tx.delete(legalParties).where(eq(legalParties.tenantId, tenant));
    await tx.delete(legalCases).where(eq(legalCases.tenantId, tenant));
    await tx.delete(legalCaseTypes).where(eq(legalCaseTypes.tenantId, tenant));
  }));
}

const audit = { createdBy: ACTOR, updatedBy: ACTOR };

beforeAll(async () => {
  await wipe(TENANT); await wipe(OTHER);
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(legalCaseTypes).values({ id: TYPE_ID, tenantId: TENANT, code: "civil", name: "Civil", ...audit });
    await tx.insert(legalCases).values({
      id: FULL, tenantId: TENANT, caseNo: "WP/D/2026", title: "A v State", court: "High Court",
      subject: "Land dispute", caseTypeId: TYPE_ID, petitioner: "A", counselRef: "Adv. Rao",
      status: "pending", nextDate: "2026-12-01", ...audit,
    });
    await tx.insert(legalCases).values({
      id: BARE, tenantId: TENANT, caseNo: "X/1/2026", title: "Bare", court: "District Court", ...audit,
    });
    await tx.insert(legalParties).values({ tenantId: TENANT, caseId: FULL, name: "State of X", role: "respondent", ...audit });
    await tx.insert(legalHearings).values([
      { tenantId: TENANT, caseId: FULL, hearingDate: "2026-11-02", court: "High Court", purpose: "Arguments", nextDate: "2026-12-01", ...audit },
      { tenantId: TENANT, caseId: FULL, hearingDate: "2026-10-01", court: "High Court", ...audit },
    ]);
    await tx.insert(legalOrders).values([
      { tenantId: TENANT, caseId: FULL, orderType: "interim", summary: "Status quo", orderDate: "2026-10-05",
        complianceRequired: true, complianceDeadline: "2026-11-30", ...audit },
      { tenantId: TENANT, caseId: FULL, orderType: "affidavit", summary: "Reply filed", orderDate: "2026-10-20", ...audit },
    ]);
  }));
  await runWithTenant(OTHER, () => db.transaction(async (tx) => {
    await tx.insert(legalCases).values({
      id: FOREIGN, tenantId: OTHER, caseNo: "WP/F/2026", title: "Foreign", court: "HC", ...audit,
    });
    // Rows in another tenant that point at TENANT's case id must never leak.
    await tx.insert(legalHearings).values({ tenantId: OTHER, caseId: FULL, hearingDate: "2026-09-09", court: "LEAK", ...audit });
    await tx.insert(legalOrders).values({ tenantId: OTHER, caseId: FULL, orderType: "judgment", summary: "LEAK", orderDate: "2026-09-09", ...audit });
  }));
  await cache.invalidateResource(TENANT, "case");
});

afterAll(async () => { await wipe(TENANT); await wipe(OTHER); await sqlClient.end(); });

describe("GET /v1/legal/cases/:id — real DB", () => {
  it("returns the documented detail shape with hearings and orders", async () => {
    const res = await get(FULL);
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b).toMatchObject({
      id: FULL, caseNo: "WP/D/2026", title: "A v State", court: "High Court",
      type: "civil", subject: "Land dispute", description: "Land dispute",
      petitioner: "A", respondent: "State of X", advocateName: "Adv. Rao",
      nextHearingDate: "2026-12-01", status: "pending",
    });
    expect(b.filedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(b.hearings.map((h: { date: string }) => h.date)).toEqual(["2026-10-01", "2026-11-02"]);
    expect(b.hearings.some((h: { court: string }) => h.court === "LEAK")).toBe(false);
    expect(b.orders).toHaveLength(2);
    expect(b.orders.some((o: { summary: string }) => o.summary === "LEAK")).toBe(false);
    expect(b.orders[0]).toMatchObject({
      orderType: "interim", summary: "Status quo", complianceRequired: true,
      complianceDeadline: "2026-11-30", status: "pending",
    });
    expect(Object.values(b).includes(null)).toBe(false);
  });

  it("CONTRACT: the real response parses with the web LegalCaseDetailSchema", async () => {
    const parsed = LegalCaseDetailSchema.safeParse((await get(FULL)).json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.hearings).toHaveLength(2);
      expect(parsed.data.orders).toHaveLength(2);
      expect(parsed.data.status).toBe("pending");
    }
  });

  it("CONTRACT: a bare case (no type/subject/counsel/dates, default 'pending') also parses", async () => {
    const res = await get(BARE);
    expect(res.statusCode).toBe(200);
    const parsed = LegalCaseDetailSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.type).toBe("other");
      expect(parsed.data.hearings).toEqual([]);
      expect(parsed.data.orders).toEqual([]);
    }
  });

  it.each(["disposed", "appealed", "stayed", "settled", "pending"])("CONTRACT: persisted status %s is accepted", (status) => {
    const base = { id: "i", caseNo: "n", title: "t", court: "c", type: "other", filedDate: "2026-01-01" };
    expect(LegalCaseDetailSchema.safeParse({ ...base, status }).success).toBe(true);
  });

  it("CONTRACT: the schema tolerates nulls on optional fields (normalised to undefined)", () => {
    const parsed = LegalCaseDetailSchema.safeParse({
      id: "i", caseNo: "n", title: "t", court: "c", type: "other", filedDate: "2026-01-01", status: "pending",
      subject: null, petitioner: null, nextHearingDate: null, description: null,
      hearings: [{ id: "h", date: "2026-01-02", court: "c", purpose: null, nextDate: null }],
      orders: [{ id: "o", date: "2026-01-03", summary: "s", orderType: null, complianceDeadline: null, status: "pending" }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.petitioner).toBeUndefined();
  });

  it("404s for another tenant's case (and a random id)", async () => {
    expect((await get(FOREIGN)).statusCode).toBe(404);
    expect((await get("99999999-9999-4999-8999-999999999999")).statusCode).toBe(404);
  });

  it("serves a case to its own tenant only", async () => {
    expect((await get(FOREIGN, ["legal_officer"], OTHER)).statusCode).toBe(200);
    expect((await get(FULL, ["legal_officer"], OTHER)).statusCode).toBe(404);
  });
});

describe("findCaseById — app-layer tenant predicate (defence in depth over RLS)", () => {
  it("returns null when the id exists but belongs to a different tenant than the one passed", async () => {
    // Inside TENANT's RLS context the row IS visible to the DB; only the
    // explicit tenant predicate can reject it.
    await runWithTenant(TENANT, async () => {
      expect(await caseRepo.findCaseById(FULL, TENANT)).not.toBeNull();
      expect(await caseRepo.findCaseById(FULL, OTHER)).toBeNull();
    });
  });

  it("getCase never serves a cached row that belongs to another tenant", async () => {
    await cache.put(cache.makeKey(OTHER, "case", "poison"), { id: "poison", tenantId: TENANT });
    expect(await caseQueries.getCase("poison", OTHER)).toBeNull();
  });
});

describe("dashboard figures", () => {
  it("ordersPending counts only compliance-required orders; opinionsDue is null (not a fake 0)", async () => {
    const d = await runWithTenant(TENANT, () => getDashboard(TENANT));
    expect(d.ordersPending).toBe(1); // 2 orders recorded, 1 requires compliance
    expect(d.opinionsDue).toBeNull();
    const parsed = LegalDashboardSchema.safeParse(d);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.opinionsDue).toBeNull();
  });
});

describe("seekOpinion placeholder", () => {
  it("is readable by the creating tenant straight after create (no 404 flash on redirect)", async () => {
    const ctx = { tenantId: TENANT, actorId: ACTOR, correlationId: "c-ph", roles: ["legal_officer"] } as never;
    const { id } = await opinionCommands.seekOpinion(ctx, { subject: "S", question: "Q", soughtBy: "Legal Cell" });
    const row = await opinionQueries.getOpinion(id, TENANT);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({ id, status: "sought", soughtBy: "Legal Cell" });
    expect(await opinionQueries.getOpinion(id, OTHER)).toBeNull();
  });
});
