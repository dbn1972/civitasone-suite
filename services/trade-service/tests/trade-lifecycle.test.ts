/**
 * DB + queue-backed smoke suite for trade-service (baseline: zero test files).
 *
 * Drives the real Fastify app (`app.inject`) end to end — create application →
 * submit → scrutiny → decide → issue licence → renew — through the actual
 * command/consumer/outbox pipeline (MemoryQueue, same wiring as production's
 * worker.ts), then asserts against the real Postgres rows.
 *
 * Also proves the two real bugs fixed alongside this suite:
 *
 *   1. GET /v1/trade/licences/verify (a public QR-code / verification-code
 *      lookup — no login, no tenant known) was rejected 401 by
 *      @civitasone/auth's global onRequest hook because the route was never
 *      marked `{ config: { public: true } }`. Confirmed live before the fix
 *      (curl, no Authorization header → 401 for every request, including a
 *      code that doesn't exist).
 *   2. Even past auth, the handler queried trade.trade_licences, which has
 *      ALTER TABLE ... FORCE ROW LEVEL SECURITY with a tenant_id-equality
 *      policy. createTenantTxHook only derives app.tenant_id from an
 *      x-tenant-id header — which a caller verifying an unknown business's
 *      licence has no way to supply — so the query ran with no GUC set and
 *      the RLS predicate evaluated to NULL for every row: the endpoint
 *      silently returned "not found" for every code, forever, regardless of
 *      database content. Fixed by adding a non-RLS public directory table
 *      (trade.trade_licence_directory — see schema.ts) kept in sync with
 *      trade_licences at issue/suspend/cancel/restore/renew time, mirroring
 *      the established services/court-service/public-lookup pattern for
 *      exactly this "public read against an RLS table" situation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { registerApplicationConsumers } from "../src/modules/applications/consumer.js";
import { registerApprovalConsumers } from "../src/modules/approvals/consumer.js";
import { registerLicenceConsumers } from "../src/modules/licences/consumer.js";
import { registerLifecycleConsumers } from "../src/modules/lifecycle/consumer.js";
import * as licenceRepo from "../src/modules/licences/repo.js";

// Production wiring (src/worker.ts) registers these against the same queue
// singleton `app.ts` publishes to; tests need the same registration so an
// HTTP-triggered 202 actually gets applied once the queue is drained.
registerApplicationConsumers(tenantScoped(queue));
registerApprovalConsumers(tenantScoped(queue));
registerLicenceConsumers(tenantScoped(queue));
registerLifecycleConsumers(tenantScoped(queue));

const T1 = "aaaaaaaa-0000-4000-8000-000000000001";
// A second tenant, used ONLY by the isolated repo-level test below, that no
// bearer()/app.inject() call anywhere in this file ever uses. AsyncLocalStorage
// context set via tenantStorage.enterWith() (createTenantTxHook) does not pop
// back like a scoped try/finally — it persists forward into whatever runs next
// on the same continuation, so a prior test's T1 request context could still be
// "current" here. Using a tenant id that is never T1 makes that isolated
// assertion correct regardless: if ambient context leaked T1, the RLS predicate
// (tenant_id = T1) still won't match a row written under T2, and if the ambient
// context is correctly unset, RLS blocks every tenant equally — either way the
// tenant-scoped lookup below must return null.
const T2 = "bbbbbbbb-0000-4000-8000-000000000002";
const ACTOR = "aaaaaaaa-0000-4000-8000-0000000000ac";
const SECRET = process.env.JWT_SECRET as string;

// createTenantTxHook (packages/db/src/tenant-tx.ts) reads AsyncLocalStorage
// tenant context from the x-tenant-id REQUEST HEADER, not from the JWT's
// `tid` claim — in production the gateway forwards this header after
// validating the token; app.inject bypasses the gateway, so tests must set
// both (same pattern as services/estab-service/tests/csmop-negative.test.ts).
function bearer(roles: string[] = ["trade_admin"]): { authorization: string; "x-tenant-id": string } {
  const token = signToken({ sub: ACTOR, roles, tid: T1 } as never, SECRET);
  return { authorization: `Bearer ${token}`, "x-tenant-id": T1 };
}

async function drain(): Promise<void> {
  await (queue as unknown as { drain: () => Promise<void> }).drain();
}

async function resetDb(): Promise<void> {
  await sqlClient`
    TRUNCATE trade.trade_licence_directory, trade.trade_licences, trade.licence_actions,
             trade.trade_renewals, trade.trade_scrutiny_records, trade.trade_applications,
             _outbox.messages, _inbox.processed
    CASCADE
  `;
}

beforeAll(resetDb);
afterAll(async () => {
  await resetDb();
  await sqlClient.end();
});

const validApplicationBody = {
  businessName: "Sharma General Store",
  tradeCategory: "retail",
  ownerName: "R. Sharma",
  premisesAddress: { line1: "12 MG Road", city: "Pune", pin: "411001" },
};

describe("trade-service — auth wall (inject)", () => {
  it("GET /v1/trade/applications with no token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/trade/applications" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/trade/licences/verify with no token and an unknown code → 404, NOT 401 (it is a public route)", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/trade/licences/verify?code=DOES-NOT-EXIST" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("trade-service — application → scrutiny → decision → licence → verify (DB + queue, inject)", () => {
  it("full happy path, ending in a licence that is publicly verifiable with NO auth header", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const hdr = bearer();

    // ── create application ──────────────────────────────────────────────
    const created = await app.inject({ method: "POST", url: "/v1/trade/applications", headers: hdr, payload: validApplicationBody });
    expect(created.statusCode).toBe(202);
    const { id: appId } = JSON.parse(created.body) as { id: string };
    await drain();

    const afterCreate = await app.inject({ method: "GET", url: `/v1/trade/applications/${appId}`, headers: hdr });
    expect(afterCreate.statusCode).toBe(200);
    const createdRow = (JSON.parse(afterCreate.body) as { data: { id: string; status: string; applicationNumber: string } }).data;
    // The 202's id must be the row's real primary key (F3 INSERT must carry
    // the same id the caller was handed) — not a mismatched, freshly generated one.
    expect(createdRow.id).toBe(appId);
    expect(createdRow.status).toBe("draft");
    expect(createdRow.applicationNumber).toMatch(/^TRADE\/ULB\/\d{4}\/\d{6}$/);

    // ── submit ───────────────────────────────────────────────────────────
    const submitted = await app.inject({ method: "POST", url: `/v1/trade/applications/${appId}/submit`, headers: hdr });
    expect(submitted.statusCode).toBe(202);
    await drain();
    // Pre-accept validation: submitting an already-submitted application is
    // rejected synchronously (422), not silently accepted as another 202.
    const resubmit = await app.inject({ method: "POST", url: `/v1/trade/applications/${appId}/submit`, headers: hdr });
    expect(resubmit.statusCode).toBe(422);

    // ── scrutiny: initiate → complete (all findings pass) ───────────────
    const scrutinyInit = await app.inject({
      method: "POST", url: "/v1/trade/approvals/scrutiny", headers: hdr,
      payload: { applicationId: appId, scrutinyType: "document_check", officerId: ACTOR },
    });
    expect(scrutinyInit.statusCode).toBe(202);
    const { id: scrutinyId } = JSON.parse(scrutinyInit.body) as { id: string };
    await drain();

    const afterInitiate = await app.inject({ method: "GET", url: `/v1/trade/applications/${appId}`, headers: hdr });
    expect((JSON.parse(afterInitiate.body) as { data: { status: string } }).data.status).toBe("under_scrutiny");

    const scrutinyComplete = await app.inject({
      method: "POST", url: `/v1/trade/approvals/scrutiny/${scrutinyId}/complete`, headers: hdr,
      payload: { findings: { items: [{ checkItem: "premises_check", result: "pass" }] } },
    });
    expect(scrutinyComplete.statusCode).toBe(202);
    await drain();

    // ── decide: approved ─────────────────────────────────────────────────
    const decision = await app.inject({
      method: "POST", url: "/v1/trade/approvals/decide", headers: hdr,
      payload: { applicationId: appId, decision: "approved" },
    });
    expect(decision.statusCode).toBe(202);
    await drain();

    const afterDecision = await app.inject({ method: "GET", url: `/v1/trade/applications/${appId}`, headers: hdr });
    expect((JSON.parse(afterDecision.body) as { data: { status: string } }).data.status).toBe("approved");

    // ── issue licence ────────────────────────────────────────────────────
    const issued = await app.inject({
      method: "POST", url: "/v1/trade/licences", headers: hdr,
      payload: { applicationId: appId, tradeCategory: "retail" },
    });
    expect(issued.statusCode).toBe(202);
    const { id: licenceId } = JSON.parse(issued.body) as { id: string };
    await drain();

    const licenceRow = (JSON.parse(
      (await app.inject({ method: "GET", url: `/v1/trade/licences/${licenceId}`, headers: hdr })).body,
    ) as { data: { id: string; status: string; verificationCode: string; licenceNumber: string } }).data;
    expect(licenceRow.id).toBe(licenceId);
    expect(licenceRow.status).toBe("active");
    expect(licenceRow.licenceNumber).toMatch(/^LIC\/TRADE\/ULB\/\d{4}\/\d{6}$/);
    const code = licenceRow.verificationCode;

    // ── THE FIX: public verification, no auth header, no tenant header ──
    const publicVerify = await app.inject({ method: "GET", url: `/v1/trade/licences/verify?code=${code}` });
    expect(publicVerify.statusCode).toBe(200);
    const publicData = (JSON.parse(publicVerify.body) as { data: { licenceNumber: string; status: string; tradeCategory: string } }).data;
    expect(publicData.licenceNumber).toBe(licenceRow.licenceNumber);
    expect(publicData.status).toBe("active");
    expect(publicData.tradeCategory).toBe("retail");

    await app.close();
  });

  it("root cause, isolated: the tenant-scoped repo path returns null with no ambient tenant; the public directory path does not", async () => {
    // Reproduces the original bug directly against the repo layer (bypassing
    // HTTP) — the exact failure mode the public verify route used to hit.
    const appId = randomUUID();
    const licenceId = randomUUID();
    const code = randomUUID().replace(/-/g, "").toUpperCase();

    await runWithTenant(T2, () =>
      db.transaction(async (tx) => {
        // No FK from trade_licences.application_id to trade_applications (see
        // migrations/0001_initial.sql — this schema has no cross-table FKs at
        // all), so a standalone applicationId is enough here; this test is
        // only exercising the licence-verification RLS path.
        await licenceRepo.insertLicence(tx as never, {
          id: licenceId, tenantId: T2, applicationId: appId, licenceNumber: "LIC/ISO/1",
          status: "active", tradeCategory: "retail", verificationCode: code,
          createdBy: ACTOR, updatedBy: ACTOR,
        });
        await licenceRepo.insertDirectoryEntry(tx as never, {
          verificationCode: code, tenantId: T2, licenceId, licenceNumber: "LIC/ISO/1",
          tradeCategory: "retail", status: "active",
        });
      }),
    );

    // No runWithTenant wrapper here — this is exactly what the public route's
    // request context looked like before the fix (no x-tenant-id header, no
    // JWT tid consulted by the DB layer): FORCE RLS silently blocks the row.
    const scoped = await licenceRepo.findByVerificationCode(code, T2);
    expect(scoped).toBeNull();

    // The public-directory path (no RLS on that table) sees it correctly.
    const publicRow = await licenceRepo.findPublicByVerificationCode(code);
    expect(publicRow?.licenceNumber).toBe("LIC/ISO/1");
    expect(publicRow?.status).toBe("active");
  });
});

describe("trade-service — licence status actions keep the public directory in sync", () => {
  it("suspend then restore is reflected in the public verify response both times", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const hdr = bearer();

    const appId = randomUUID();
    const licenceId = randomUUID();
    const code = randomUUID().replace(/-/g, "").toUpperCase();
    await runWithTenant(T1, () =>
      db.transaction(async (tx) => {
        await licenceRepo.insertLicence(tx as never, {
          id: licenceId, tenantId: T1, applicationId: appId, licenceNumber: "LIC/SYNC/1",
          status: "active", tradeCategory: "retail", verificationCode: code, createdBy: ACTOR, updatedBy: ACTOR,
        });
        await licenceRepo.insertDirectoryEntry(tx as never, {
          verificationCode: code, tenantId: T1, licenceId, licenceNumber: "LIC/SYNC/1",
          tradeCategory: "retail", status: "active",
        });
      }),
    );

    const suspend = await app.inject({ method: "POST", url: `/v1/trade/licences/${licenceId}/suspend`, headers: hdr, payload: { reason: "pending inspection" } });
    expect(suspend.statusCode).toBe(202);
    await drain();
    const afterSuspend = await app.inject({ method: "GET", url: `/v1/trade/licences/verify?code=${code}` });
    expect((JSON.parse(afterSuspend.body) as { data: { status: string } }).data.status).toBe("suspended");

    const restore = await app.inject({ method: "POST", url: `/v1/trade/licences/${licenceId}/restore`, headers: hdr, payload: { reason: "inspection cleared" } });
    expect(restore.statusCode).toBe(202);
    await drain();
    const afterRestore = await app.inject({ method: "GET", url: `/v1/trade/licences/verify?code=${code}` });
    expect((JSON.parse(afterRestore.body) as { data: { status: string } }).data.status).toBe("active");

    await app.close();
  });

  it("an approved renewal extends validUntil in both the record and the public directory", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const hdr = bearer();

    const appId = randomUUID();
    const licenceId = randomUUID();
    const code = randomUUID().replace(/-/g, "").toUpperCase();
    const originalValidUntil = new Date(Date.now() + 1000 * 60 * 60 * 24 * 10); // 10 days out
    await runWithTenant(T1, () =>
      db.transaction(async (tx) => {
        await licenceRepo.insertLicence(tx as never, {
          id: licenceId, tenantId: T1, applicationId: appId, licenceNumber: "LIC/RENEW/1",
          status: "active", tradeCategory: "retail", verificationCode: code,
          validUntil: originalValidUntil, createdBy: ACTOR, updatedBy: ACTOR,
        });
        await licenceRepo.insertDirectoryEntry(tx as never, {
          verificationCode: code, tenantId: T1, licenceId, licenceNumber: "LIC/RENEW/1",
          tradeCategory: "retail", status: "active", validUntil: originalValidUntil,
        });
      }),
    );

    const requested = await app.inject({
      method: "POST", url: "/v1/trade/renewals", headers: hdr,
      payload: { licenceId, renewalType: "renewal" },
    });
    expect(requested.statusCode).toBe(202);
    const { id: renewalId } = JSON.parse(requested.body) as { id: string };
    await drain();

    const decided = await app.inject({ method: "POST", url: `/v1/trade/renewals/${renewalId}/decide`, headers: hdr, payload: { decision: "approved" } });
    expect(decided.statusCode).toBe(202);
    await drain();

    const verify = await app.inject({ method: "GET", url: `/v1/trade/licences/verify?code=${code}` });
    const validUntil = new Date((JSON.parse(verify.body) as { data: { validUntil: string } }).data.validUntil);
    expect(validUntil.getTime()).toBeGreaterThan(originalValidUntil.getTime());

    await app.close();
  });
});

describe("trade-service — pre-accept validation gap fixed on the notices route", () => {
  it("POST /v1/trade/licences/notices for a licenceId that does not exist → 404, not 202", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/trade/licences/notices", headers: bearer(),
      payload: { licenceId: randomUUID(), noticeDetails: { text: "hello" } },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("trade-service — pre-accept validation on POST /v1/trade/licences (issue)", () => {
  it("applicationId that does not exist → 404, not 202", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/trade/licences", headers: bearer(),
      payload: { applicationId: randomUUID(), tradeCategory: "retail" },
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { code: string };
    expect(body.code).toBe("APPLICATION_NOT_FOUND");
    await app.close();
  });

  it("application exists but is still 'draft' (never approved) → 422, not 202", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const hdr = bearer();

    const created = await app.inject({ method: "POST", url: "/v1/trade/applications", headers: hdr, payload: validApplicationBody });
    expect(created.statusCode).toBe(202);
    const { id: appId } = JSON.parse(created.body) as { id: string };
    await drain();

    // Deliberately never submitted/scrutinised/approved — still 'draft'.
    const res = await app.inject({
      method: "POST", url: "/v1/trade/licences", headers: hdr,
      payload: { applicationId: appId, tradeCategory: "retail" },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body) as { code: string };
    expect(body.code).toBe("APPLICATION_NOT_APPROVED");
    await app.close();
  });

  it("a second issue attempt against an application that already has a licence → 409, not another licence", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const hdr = bearer();

    // Drive an application all the way to 'approved'.
    const created = await app.inject({ method: "POST", url: "/v1/trade/applications", headers: hdr, payload: validApplicationBody });
    const { id: appId } = JSON.parse(created.body) as { id: string };
    await drain();
    await app.inject({ method: "POST", url: `/v1/trade/applications/${appId}/submit`, headers: hdr });
    await drain();
    const scrutinyInit = await app.inject({
      method: "POST", url: "/v1/trade/approvals/scrutiny", headers: hdr,
      payload: { applicationId: appId, scrutinyType: "document_check", officerId: ACTOR },
    });
    const { id: scrutinyId } = JSON.parse(scrutinyInit.body) as { id: string };
    await drain();
    await app.inject({
      method: "POST", url: `/v1/trade/approvals/scrutiny/${scrutinyId}/complete`, headers: hdr,
      payload: { findings: { items: [{ checkItem: "premises_check", result: "pass" }] } },
    });
    await drain();
    await app.inject({
      method: "POST", url: "/v1/trade/approvals/decide", headers: hdr,
      payload: { applicationId: appId, decision: "approved" },
    });
    await drain();

    // First issue succeeds.
    const firstIssue = await app.inject({
      method: "POST", url: "/v1/trade/licences", headers: hdr,
      payload: { applicationId: appId, tradeCategory: "retail" },
    });
    expect(firstIssue.statusCode).toBe(202);
    await drain();

    // Retry / double-click / concurrent request against the same application
    // must be rejected cleanly, not silently issue a second licence row.
    const secondIssue = await app.inject({
      method: "POST", url: "/v1/trade/licences", headers: hdr,
      payload: { applicationId: appId, tradeCategory: "retail" },
    });
    expect(secondIssue.statusCode).toBe(409);
    const body = JSON.parse(secondIssue.body) as { code: string };
    expect(body.code).toBe("LICENCE_ALREADY_EXISTS");

    await app.close();
  });

  it("a cancelled licence does not block a fresh licence for the same application (partial unique index, not a plain UNIQUE)", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const hdr = bearer();

    const created = await app.inject({ method: "POST", url: "/v1/trade/applications", headers: hdr, payload: validApplicationBody });
    const { id: appId } = JSON.parse(created.body) as { id: string };
    await drain();
    await app.inject({ method: "POST", url: `/v1/trade/applications/${appId}/submit`, headers: hdr });
    await drain();
    const scrutinyInit = await app.inject({
      method: "POST", url: "/v1/trade/approvals/scrutiny", headers: hdr,
      payload: { applicationId: appId, scrutinyType: "document_check", officerId: ACTOR },
    });
    const { id: scrutinyId } = JSON.parse(scrutinyInit.body) as { id: string };
    await drain();
    await app.inject({
      method: "POST", url: `/v1/trade/approvals/scrutiny/${scrutinyId}/complete`, headers: hdr,
      payload: { findings: { items: [{ checkItem: "premises_check", result: "pass" }] } },
    });
    await drain();
    await app.inject({
      method: "POST", url: "/v1/trade/approvals/decide", headers: hdr,
      payload: { applicationId: appId, decision: "approved" },
    });
    await drain();

    const firstIssue = await app.inject({
      method: "POST", url: "/v1/trade/licences", headers: hdr,
      payload: { applicationId: appId, tradeCategory: "retail" },
    });
    expect(firstIssue.statusCode).toBe(202);
    const { id: firstLicenceId } = JSON.parse(firstIssue.body) as { id: string };
    await drain();

    const cancel = await app.inject({
      method: "POST", url: `/v1/trade/licences/${firstLicenceId}/cancel`, headers: hdr,
      payload: { reason: "issued in error, applicant needs to reapply" },
    });
    expect(cancel.statusCode).toBe(202);
    await drain();
    const cancelled = await licenceRepo.findById(firstLicenceId, T1);
    expect(cancelled!.status).toBe("cancelled");

    // trade_licences_application_active_unique (migrations/0003) and
    // findByApplicationId's app-level pre-check must both treat the
    // cancelled licence as non-blocking.
    const reissue = await app.inject({
      method: "POST", url: "/v1/trade/licences", headers: hdr,
      payload: { applicationId: appId, tradeCategory: "retail" },
    });
    expect(reissue.statusCode).toBe(202);
    const { id: secondLicenceId } = JSON.parse(reissue.body) as { id: string };
    expect(secondLicenceId).not.toBe(firstLicenceId);
    await drain();

    const reissued = await licenceRepo.findById(secondLicenceId, T1);
    expect(reissued).not.toBeNull();
    expect(reissued!.status).toBe("active");

    await app.close();
  });
});
