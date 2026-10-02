/**
 * R-RA-0111 follow-up: the exact interleaving behind the intermittent
 * "expected STALE_OVERRIDE to be NOT_PENDING" in
 * screening-override-decision-race.test.ts, forced deterministically.
 *
 * /approve reads the override request (mustReq), then the application
 * (screeningRepo.findApplication). When a competing approver commits between
 * those two reads, the loser saw a still-pending request but an application
 * already rewritten by the winner, and answered 409 STALE_OVERRIDE ("the
 * application changed ... re-raise it") although the request had simply been
 * decided by someone else. findApplication is wrapped below so the competing
 * approval runs at exactly that point; everything else is the real route and
 * real Postgres.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";

const hook = vi.hoisted(() => ({ beforeFindApplication: null as null | (() => Promise<void>) }));

vi.mock("../src/modules/recruitment/screening-repo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules/recruitment/screening-repo.js")>();
  return {
    ...actual,
    findApplication: async (...args: Parameters<typeof actual.findApplication>) => {
      const fn = hook.beforeFindApplication;
      hook.beforeFindApplication = null; // one shot: the competing request reads normally
      if (fn) await fn();
      return actual.findApplication(...args);
    },
  };
});

import { db, sqlClient } from "../src/shared/db.js";
import { hrmsApplications, hrmsJobOpenings, hrmsScreeningEvents, hrmsScreeningOverrides } from "../src/modules/recruitment/schema.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const VAC = randomUUID();
const REQUESTER = randomUUID();
const SCREENER = randomUUID();
const APPROVER_1 = randomUUID();
const APPROVER_2 = randomUUID();

const auth = (sub: string) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}`,
});

function inTenant<T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;
}

beforeAll(async () => {
  await inTenant((tx) => tx.insert(hrmsJobOpenings).values({
    id: VAC, tenantId: TENANT, refNo: "REF-OVERRIDE-INTERLEAVE-1", title: "Override Interleaving Test Vacancy",
    departmentId: randomUUID(), createdBy: ACTOR, updatedBy: ACTOR,
  }));
});

afterAll(async () => {
  await inTenant(async (tx) => {
    await tx.delete(hrmsScreeningEvents).where(eq(hrmsScreeningEvents.tenantId, TENANT));
    await tx.delete(hrmsScreeningOverrides).where(eq(hrmsScreeningOverrides.tenantId, TENANT));
    await tx.delete(hrmsApplications).where(eq(hrmsApplications.tenantId, TENANT));
    await tx.delete(hrmsJobOpenings).where(eq(hrmsJobOpenings.tenantId, TENANT));
  });
  await sqlClient.end();
});

describe("screening-override /approve — competing approval lands between the request and application reads", () => {
  it("the loser gets 409 NOT_PENDING (not STALE_OVERRIDE), audited once, and the winner's decision stands", async () => {
    const appId = randomUUID();
    const reqId = randomUUID();
    await inTenant((tx) => tx.insert(hrmsApplications).values({
      id: appId, tenantId: TENANT, jobOpeningId: VAC, applicantName: "Interleaving Applicant",
      screeningDecision: "ineligible", screeningReasonCode: "experience",
      screenedBy: SCREENER, screenedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
    }));
    await inTenant((tx) => tx.insert(hrmsScreeningOverrides).values({
      id: reqId, tenantId: TENANT, applicationId: appId, jobOpeningId: VAC,
      fromDecision: "ineligible", toDecision: "eligible", applicationVersion: 1,
      reason: "docs re-verified on appeal", status: "pending",
      originalScreenedBy: SCREENER, requestedBy: REQUESTER,
    }));
    const app = await buildApp();
    try {
      let winner: { statusCode: number } | null = null;
      hook.beforeFindApplication = async () => {
        winner = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${reqId}/approve`, headers: auth(APPROVER_1), payload: {} });
      };

      const loser = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${reqId}/approve`, headers: auth(APPROVER_2), payload: {} });

      expect(winner).not.toBeNull();
      expect(winner!.statusCode).toBe(200);
      expect(loser.statusCode).toBe(409);
      expect(loser.json().code).toBe("NOT_PENDING");

      const [req] = await inTenant((tx) => tx.select().from(hrmsScreeningOverrides)
        .where(and(eq(hrmsScreeningOverrides.tenantId, TENANT), eq(hrmsScreeningOverrides.id, reqId))));
      expect(req!.status).toBe("approved");
      expect(req!.decidedBy).toBe(APPROVER_1);

      const events = await inTenant((tx) => tx.select().from(hrmsScreeningEvents)
        .where(and(eq(hrmsScreeningEvents.tenantId, TENANT), eq(hrmsScreeningEvents.applicationId, appId))));
      expect(events.filter((e) => e.action === "override")).toHaveLength(1);
      expect(events.filter((e) => e.action === "override_denied")).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
