/**
 * GAP-GRANTS-APPLICATIONS-DETAIL-05 (UAT B4): the reviewer is now chosen from the tenant
 * user directory (a user id, sent as "identity_user:<uuid>"), so the server can enforce
 * what a free-text label never could: the assigned or scoring reviewer must not be the
 * applicant who submitted the application (separation of duties). The detail read-model
 * exposes both the assigned reviewer and the reviewer who scored, separately.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Queue, Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { grantSchemes } from "../src/modules/scheme/schema.js";
import { grantApplications, grantScores } from "../src/modules/application/schema.js";
import { grantBeneficiaries } from "../src/modules/beneficiary/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerApplicationConsumers } from "../src/modules/application/consumer.js";
import { reviewerUserId } from "../src/modules/application/domain.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const SUBMITTER = randomUUID();
const REVIEWER = randomUUID();
const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const scoped = <T>(fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

const APP_ID = randomUUID();

async function call(method: "GET" | "PATCH", url: string, payload?: unknown) {
  const app = await buildApp();
  const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["grant_admin"], sid: "s-b4r" }, SECRET, 3600);
  const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload: payload as object } : {}) });
  await app.close();
  return res;
}

beforeAll(async () => {
  const q = queue as unknown as Queue;
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  registerApplicationConsumers(q);
  await q.start();

  const schemeId = randomUUID(), benId = randomUUID();
  await scoped(async (tx) => {
    await tx.insert(grantSchemes).values({
      id: schemeId, tenantId: TENANT, code: `B4R-${schemeId.slice(0, 8)}`, name: "B4 Reviewer Scheme",
      budgetMinor: 1_000_000n, maxAmountMinor: 1_000_000n, status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(grantBeneficiaries).values({ id: benId, tenantId: TENANT, name: "Some Society", type: "society", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(grantApplications).values({
      id: APP_ID, tenantId: TENANT, grantNo: `G-B4R-${APP_ID.slice(0, 6)}`, schemeId, beneficiaryId: benId,
      purpose: "B4 reviewer application", amountRequestedMinor: 100_000n, status: "submitted",
      submittedBy: SUBMITTER, createdBy: SUBMITTER, updatedBy: SUBMITTER,
    });
  });
});

afterAll(async () => {
  await queue.stop();
  await scoped(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(grantScores).where(eq(grantScores.tenantId, TENANT));
    await tx.delete(grantApplications).where(eq(grantApplications.tenantId, TENANT));
    await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, TENANT));
    await tx.delete(grantSchemes).where(eq(grantSchemes.tenantId, TENANT));
  });
  await sqlClient.end();
});

async function waitFor<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  const deadline = Date.now() + 4000;
  let v = await read();
  while (!ok(v) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 50)); v = await read(); }
  return v;
}
const readApp = async () => (await scoped((tx) => tx.select().from(grantApplications).where(eq(grantApplications.id, APP_ID))))[0]!;

describe("reviewerUserId (pure)", () => {
  it("extracts the user id from an identity_user ref and passes a bare id through", () => {
    expect(reviewerUserId(`identity_user:${REVIEWER}`)).toBe(REVIEWER);
    expect(reviewerUserId(REVIEWER)).toBe(REVIEWER);
    expect(reviewerUserId("  Dr. A. Kulkarni ")).toBe("Dr. A. Kulkarni");
  });
});

describe("reviewer must differ from the submitter", () => {
  it("assign-reviewer: 403 SOD_VIOLATION when the chosen reviewer is the submitter", async () => {
    const res = await call("PATCH", `/v1/grants/applications/${APP_ID}/assign-reviewer`, { reviewerRef: `identity_user:${SUBMITTER}` });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SOD_VIOLATION");
    expect((await readApp()).reviewerRef).toBeNull();
  });

  it("score: 403 SOD_VIOLATION when the scoring reviewer is the submitter", async () => {
    const res = await call("PATCH", `/v1/grants/applications/${APP_ID}/score`, {
      reviewerRef: `identity_user:${SUBMITTER}`, technicalScore: 80, financialScore: 70,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SOD_VIOLATION");
  });

  it("assign-reviewer then score with a different user stores the refs and the detail exposes both", async () => {
    const ref = `identity_user:${REVIEWER}`;
    expect((await call("PATCH", `/v1/grants/applications/${APP_ID}/assign-reviewer`, { reviewerRef: ref })).statusCode).toBe(202);
    expect((await waitFor(readApp, (a) => a.reviewerRef === ref)).reviewerRef).toBe(ref);

    expect((await call("PATCH", `/v1/grants/applications/${APP_ID}/score`, {
      reviewerRef: ref, technicalScore: 82, financialScore: 70, recommendation: "Recommended",
    })).statusCode).toBe(202);
    await waitFor(async () => scoped((tx) => tx.select().from(grantScores).where(eq(grantScores.applicationId, APP_ID))), (r) => r.length === 1);

    const detail = (await call("GET", `/v1/grants/applications/${APP_ID}`)).json();
    expect(detail.reviewerRef).toBe(ref);
    expect(detail.scoredReviewerRef).toBe(ref);
    expect(detail.technicalScore).toBe(82);
    expect(detail.totalScore).toBe(76);
  });
});
