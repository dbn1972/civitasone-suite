/**
 * UAT g3 regression tests (grant-service):
 *  #9  PATCH /applications/:id/reject on a non-under_review application is refused synchronously (422)
 *  #10 POST /applications/:id/installments is refused for an application that is not approved (422)
 *  #14 updateScheme bumps `version`
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { grantSchemes } from "../src/modules/scheme/schema.js";
import { updateScheme } from "../src/modules/scheme/repo.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantInstallments } from "../src/modules/disbursement/schema.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const scoped = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));
const auth = () => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["grant_officer"], sid: "s-g3" }, SECRET, 3600)}` });

async function seed(status: string, approved: bigint) {
  const schemeId = randomUUID(), appId = randomUUID();
  await scoped(async (tx) => {
    await tx.insert(grantSchemes).values({ id: schemeId, tenantId: TENANT, code: `G3-${schemeId.slice(0, 8)}`, name: "UATTEST scheme", status: "active", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(grantApplications).values({
      id: appId, tenantId: TENANT, grantNo: `G-G3-${appId.slice(0, 6)}`, schemeId, beneficiaryId: randomUUID(),
      purpose: "UATTEST", amountRequestedMinor: 1_000_000n, amountApprovedMinor: approved, status, createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
  return { schemeId, appId };
}

afterAll(async () => {
  await scoped(async (tx) => {
    await tx.delete(grantInstallments).where(eq(grantInstallments.tenantId, TENANT));
    await tx.delete(grantApplications).where(eq(grantApplications.tenantId, TENANT));
    await tx.delete(grantSchemes).where(eq(grantSchemes.tenantId, TENANT));
  });
  await sqlClient.end();
});

describe("#9 reject is validated synchronously", () => {
  it("422 INVALID_TRANSITION for a 'submitted' application, 404 for an unknown one, 202 for under_review", async () => {
    const app = await buildApp();
    try {
      const sub = await seed("submitted", 0n);
      const r1 = await app.inject({ method: "PATCH", url: `/v1/grants/applications/${sub.appId}/reject`, headers: auth(), payload: { reason: "UATTEST rejection reason" } });
      expect(r1.statusCode).toBe(422);
      expect(JSON.stringify(r1.json())).toContain("INVALID_TRANSITION");
      const r2 = await app.inject({ method: "PATCH", url: `/v1/grants/applications/${randomUUID()}/reject`, headers: auth(), payload: { reason: "UATTEST rejection reason" } });
      expect(r2.statusCode).toBe(404);
      const rev = await seed("under_review", 0n);
      const r3 = await app.inject({ method: "PATCH", url: `/v1/grants/applications/${rev.appId}/reject`, headers: auth(), payload: { reason: "UATTEST rejection reason" } });
      expect(r3.statusCode).toBe(202);
    } finally {
      await app.close();
    }
  });
});

describe("#10 installments require an approved application", () => {
  const body = { installments: [{ installmentNo: 1, amountMinor: 500_000, dueDate: "2026-12-01" }] };
  it("422 for a submitted application (approved amount 0) and for an approved one with a zero amount; 202 when approved with an amount", async () => {
    const app = await buildApp();
    try {
      const sub = await seed("submitted", 0n);
      const r1 = await app.inject({ method: "POST", url: `/v1/grants/applications/${sub.appId}/installments`, headers: auth(), payload: body });
      expect(r1.statusCode).toBe(422);
      expect(JSON.stringify(r1.json())).toContain("APPLICATION_NOT_APPROVED");
      const zero = await seed("approved", 0n);
      expect((await app.inject({ method: "POST", url: `/v1/grants/applications/${zero.appId}/installments`, headers: auth(), payload: body })).statusCode).toBe(422);
      expect((await app.inject({ method: "POST", url: `/v1/grants/applications/${randomUUID()}/installments`, headers: auth(), payload: body })).statusCode).toBe(404);
      const ok = await seed("approved", 1_000_000n);
      expect((await app.inject({ method: "POST", url: `/v1/grants/applications/${ok.appId}/installments`, headers: auth(), payload: body })).statusCode).toBe(202);
    } finally {
      await app.close();
    }
  });
});

describe("#14 scheme update bumps version", () => {
  it("version goes 1 -> 2", async () => {
    const { schemeId } = await seed("draft", 0n);
    await scoped((tx) => updateScheme(tx, schemeId, { name: "UATTEST renamed" }));
    const row = (await scoped((tx) => tx.select().from(grantSchemes).where(eq(grantSchemes.id, schemeId))))[0]!;
    expect(row.name).toBe("UATTEST renamed");
    expect(row.version).toBe(2);
  });
});
