/**
 * Customer onboarding with a KYC gate (P1-9).
 *
 * The trigger is the deal-won EVENT, so these tests drive the real production path:
 * close the deal over HTTP → the deal consumer commits the close and the event into
 * the outbox → the outbox is relayed onto the bus → the onboarding consumer opens the
 * case. `relayTenantEvents` is the worker's relay narrowed to one tenant (same
 * contract: messageId = outbox row id) so a parallel test file's events are not
 * consumed out from under it.
 *
 * Writes are CQRS: routes return 202 and state is asserted through the read path only
 * after the queue has drained.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { captureHandlers, drainQueue, envelope } from "./consumer-harness.js";
import {
  allowedNextStages,
  canKycTransition,
  canTransition,
  isKycGateSatisfied,
  isKycSatisfied,
  isTerminalStage,
  isValidCancellationReason,
  requiresCancellationReason,
  requiresKycVerification,
} from "../src/modules/onboarding/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "aaaaaaaa-1111-4000-8000-000000000091";
const TENANT_B = "bbbbbbbb-2222-4000-8000-000000000091";
const ACTOR_A = "cccccccc-3333-4000-8000-000000000091";
const ACTOR_B = "dddddddd-4444-4000-8000-000000000091";
const ACCOUNT_A = "eeeeeeee-5555-4000-8000-000000000091";
const CONTACT_A = "ffffffff-6666-4000-8000-000000000091";

const DEAL_MAIN = "11111111-aaaa-4000-8000-000000000091";
const DEAL_STAGE = "22222222-aaaa-4000-8000-000000000091";
const DEAL_IDEM = "33333333-aaaa-4000-8000-000000000091";

const REASON = "customer withdrew before provisioning";

type CaseView = {
  id: string;
  dealId: string;
  accountId: string | null;
  stage: string;
  kycStatus: string;
  kycVerifiedAt: string | null;
  completedAt: string | null;
  cancellationReason: string | null;
  version: number;
};

function headers(
  tenantId: string = TENANT_A,
  actorId: string = ACTOR_A,
  roles: string[] = ["crm_admin"],
): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-onb" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(
  method: "GET" | "POST" | "PATCH",
  url: string,
  opts: { headers?: Record<string, string>; payload?: unknown } = {},
) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
    headers: opts.headers ?? headers(),
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
  });
  await app.close();
  await drainQueue();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];

function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * The worker's outbox relay, scoped to one tenant. Publishes every unpublished row
 * with `messageId` set to the outbox row id — exactly what `relayOnce` does — so the
 * consumer's inbox dedupe behaves the same here as in production.
 */
async function relayTenantEvents(tenantId: string): Promise<void> {
  const rows = (await scoped(tenantId, (tx) => tx`
    SELECT id, topic, event_type AS "eventType", tenant_id AS "tenantId",
           actor_id AS "actorId", correlation_id AS "correlationId", payload
    FROM _outbox.messages
    WHERE tenant_id = ${tenantId} AND published_at IS NULL
    ORDER BY created_at
  `)) as unknown as Array<{
    id: string; topic: string; eventType: string; tenantId: string;
    actorId: string; correlationId: string; payload: Record<string, unknown>;
  }>;

  await scoped(tenantId, (tx) => tx`
    UPDATE _outbox.messages SET published_at = now()
    WHERE tenant_id = ${tenantId} AND published_at IS NULL
  `);

  for (const row of rows) {
    await queue.publish(row.topic, {
      messageId: row.id,
      type: row.eventType,
      tenantId: row.tenantId,
      actorId: row.actorId,
      correlationId: row.correlationId,
      schemaVersion: "1.0",
      payload: row.payload,
    });
  }
  await drainQueue();
}

async function caseForDeal(dealId: string): Promise<CaseView | undefined> {
  const res = await call("GET", "/v1/crm/onboarding-cases?limit=200");
  expect(res.statusCode).toBe(200);
  return (res.json().data as CaseView[]).find((c) => c.dealId === dealId);
}

async function getCase(id: string): Promise<CaseView> {
  const res = await call("GET", `/v1/crm/onboarding-cases/${id}`);
  expect(res.statusCode, `case ${id} should be readable`).toBe(200);
  return res.json() as CaseView;
}

function moveStage(id: string, payload: Record<string, unknown>) {
  return call("POST", `/v1/crm/onboarding-cases/${id}/stage`, { payload });
}

function recordKyc(id: string, payload: Record<string, unknown>, hdrs?: Record<string, string>) {
  return call("POST", `/v1/crm/onboarding-cases/${id}/kyc`, { payload, ...(hdrs ? { headers: hdrs } : {}) });
}

/** Audit outcomes recorded against a case, oldest first. */
async function auditOutcomes(caseId: string): Promise<string[]> {
  const rows = (await scoped(TENANT_A, (tx) => tx`
    SELECT payload FROM _outbox.messages
    WHERE tenant_id = ${TENANT_A} AND event_type = 'audit.event.record'
      AND payload->>'resourceId' = ${caseId}
    ORDER BY created_at
  `)) as unknown as Array<{ payload: { outcome: string } }>;
  return rows.map((r) => r.payload.outcome);
}

async function seedDeal(id: string, name: string, contactId: string | null): Promise<void> {
  await scoped(TENANT_A, async (tx) => {
    await tx`
      INSERT INTO crm.deals
        (id, tenant_id, name, stage, value_minor, currency, contact_id, status, version,
         created_at, updated_at, created_by, updated_by)
      VALUES (${id}, ${TENANT_A}, ${name}, 'Negotiation', 500000, 'INR', ${contactId},
              'active', 1, now(), now(), ${ACTOR_A}, ${ACTOR_A})
      ON CONFLICT (id) DO NOTHING
    `;
  });
}

async function cleanup(): Promise<void> {
  for (const tenant of [TENANT_A, TENANT_B]) {
    await scoped(tenant, async (tx) => {
      await tx`DELETE FROM crm.onboarding_cases WHERE tenant_id = ${tenant}`;
      await tx`DELETE FROM crm.deals WHERE tenant_id = ${tenant}`;
      await tx`DELETE FROM crm.contacts WHERE tenant_id = ${tenant}`;
      await tx`DELETE FROM crm.accounts WHERE tenant_id = ${tenant}`;
      await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${tenant}`;
    }).catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();
  await scoped(TENANT_A, async (tx) => {
    await tx`
      INSERT INTO crm.accounts (id, tenant_id, name, created_by, updated_by)
      VALUES (${ACCOUNT_A}, ${TENANT_A}, 'Onboarding Co', ${ACTOR_A}, ${ACTOR_A})
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, account_id, created_by, updated_by)
      VALUES (${CONTACT_A}, ${TENANT_A}, 'Onboarding Contact', ${ACCOUNT_A}, ${ACTOR_A}, ${ACTOR_A})
      ON CONFLICT (id) DO NOTHING
    `;
  });
  await seedDeal(DEAL_MAIN, "Onboarding Main Deal", CONTACT_A);
  await seedDeal(DEAL_STAGE, "Onboarding Stage Deal", CONTACT_A);
  await seedDeal(DEAL_IDEM, "Onboarding Idempotency Deal", CONTACT_A);
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await drainQueue();
  await cleanup();
  await sqlClient.end();
});

describe("onboarding domain — stage machine", () => {
  it("walks the defined sequence one step at a time", () => {
    expect(canTransition("initiated", "documents_submitted")).toBe(true);
    expect(canTransition("documents_submitted", "verification")).toBe(true);
    expect(canTransition("verification", "provisioning")).toBe(true);
    expect(canTransition("provisioning", "completed")).toBe(true);
  });

  it("rejects skipping a stage and going backwards", () => {
    expect(canTransition("initiated", "provisioning")).toBe(false);
    expect(canTransition("initiated", "completed")).toBe(false);
    expect(canTransition("provisioning", "verification")).toBe(false);
  });

  it("treats completed and cancelled as terminal", () => {
    expect(isTerminalStage("completed")).toBe(true);
    expect(isTerminalStage("cancelled")).toBe(true);
    expect(allowedNextStages("completed")).toEqual([]);
    expect(canTransition("cancelled", "initiated")).toBe(false);
  });

  it("allows cancellation from every live stage, with a reason", () => {
    for (const stage of ["initiated", "documents_submitted", "verification", "provisioning"] as const) {
      expect(canTransition(stage, "cancelled")).toBe(true);
    }
    expect(requiresCancellationReason("cancelled")).toBe(true);
    expect(isValidCancellationReason("too short")).toBe(false);
    expect(isValidCancellationReason(REASON)).toBe(true);
  });
});

describe("onboarding domain — KYC gate", () => {
  it("gates completion and nothing else", () => {
    expect(requiresKycVerification("completed")).toBe(true);
    expect(requiresKycVerification("provisioning")).toBe(false);
    expect(isKycGateSatisfied("provisioning", "pending")).toBe(true);
  });

  it("refuses completion for every unverified KYC status", () => {
    for (const status of ["pending", "submitted", "rejected"] as const) {
      expect(isKycSatisfied(status)).toBe(false);
      expect(isKycGateSatisfied("completed", status)).toBe(false);
    }
    expect(isKycGateSatisfied("completed", "verified")).toBe(true);
  });

  it("lets a rejected check be re-filed but never un-verifies a passed one", () => {
    expect(canKycTransition("pending", "submitted")).toBe(true);
    expect(canKycTransition("submitted", "verified")).toBe(true);
    expect(canKycTransition("rejected", "submitted")).toBe(true);
    expect(canKycTransition("pending", "verified")).toBe(false);
    expect(canKycTransition("verified", "rejected")).toBe(false);
  });
});

describe("onboarding trigger — a won deal opens a case", () => {
  let caseId: string;

  it("opens a case when a deal is closed as won", async () => {
    const closed = await call("POST", `/v1/crm/deals/${DEAL_MAIN}/close`, {
      payload: { outcome: "won", closedValue: "500000" },
    });
    expect(closed.statusCode).toBe(202);
    await relayTenantEvents(TENANT_A);

    const opened = await caseForDeal(DEAL_MAIN);
    expect(opened, "a won deal must open an onboarding case").toBeDefined();
    caseId = opened!.id;
    expect(opened!.stage).toBe("initiated");
    expect(opened!.kycStatus).toBe("pending");
    expect(opened!.completedAt).toBeNull();
    // Resolved from the deal's contact and stamped on the event, so the onboarding
    // module never reads a deal or contact row.
    expect(opened!.accountId).toBe(ACCOUNT_A);
  });

  it("opens a case when a deal is moved to the Won stage directly", async () => {
    const moved = await call("PATCH", `/v1/crm/deals/${DEAL_STAGE}/stage`, {
      payload: { stage: "Won", version: 1 },
    });
    expect(moved.statusCode).toBe(202);
    await relayTenantEvents(TENANT_A);

    const opened = await caseForDeal(DEAL_STAGE);
    expect(opened).toBeDefined();
    expect(opened!.stage).toBe("initiated");
    expect(opened!.accountId).toBe(ACCOUNT_A);
  });

  it("does not open a case for a deal that was lost", async () => {
    const lostDeal = "44444444-aaaa-4000-8000-000000000091";
    await seedDeal(lostDeal, "Onboarding Lost Deal", CONTACT_A);
    const closed = await call("POST", `/v1/crm/deals/${lostDeal}/close`, {
      payload: { outcome: "lost", reason: "budget was pulled by the customer" },
    });
    expect(closed.statusCode).toBe(202);
    await relayTenantEvents(TENANT_A);

    expect(await caseForDeal(lostDeal)).toBeUndefined();
  });

  it("rejects an out-of-order stage move with 422 and leaves the case untouched", async () => {
    const before = await getCase(caseId);
    const res = await moveStage(caseId, { toStage: "provisioning" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_TRANSITION");

    const after = await getCase(caseId);
    expect(after.stage).toBe(before.stage);
    expect(after.version).toBe(before.version);
  });

  it("rejects a stale version with 409 rather than accepting a command that would be dropped", async () => {
    const res = await moveStage(caseId, { toStage: "documents_submitted", version: 99 });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });

  it("advances through the defined sequence up to provisioning", async () => {
    for (const toStage of ["documents_submitted", "verification", "provisioning"]) {
      const res = await moveStage(caseId, { toStage });
      expect(res.statusCode, `move to ${toStage}`).toBe(202);
      expect((await getCase(caseId)).stage).toBe(toStage);
    }
  });

  it("refuses to complete while KYC is unverified — 422 at the route, not a silent 202", async () => {
    const before = await getCase(caseId);
    expect(before.stage).toBe("provisioning");
    expect(before.kycStatus).toBe("pending");

    const res = await moveStage(caseId, { toStage: "completed" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("KYC_NOT_VERIFIED");

    const after = await getCase(caseId);
    expect(after.stage).toBe("provisioning");
    expect(after.completedAt).toBeNull();
    expect(after.version).toBe(before.version);
  });

  it("refuses to complete in the consumer even when the route is bypassed", async () => {
    // Forge the command the route would never publish. This is the guard that matters:
    // the route's check is a snapshot, the consumer's is the one the write goes through.
    const before = await getCase(caseId);
    const handler = captureHandlers().handlerFor(COMMANDS.advanceOnboardingStage);
    const msg = envelope(COMMANDS.advanceOnboardingStage, {
      id: caseId,
      tenantId: TENANT_A,
      toStage: "completed",
      fromStage: "provisioning",
      cancellationReason: null,
      version: before.version,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    await runWithTenant(TENANT_A, () => handler(msg));

    const after = await getCase(caseId);
    expect(after.stage).toBe("provisioning");
    expect(after.completedAt).toBeNull();
    expect(after.version).toBe(before.version);
    expect(await auditOutcomes(caseId)).toContain("rejected_kyc_not_verified");
  });

  it("refuses a KYC verification from a user without an approver role", async () => {
    const res = await recordKyc(caseId, { status: "submitted" });
    expect(res.statusCode).toBe(202);

    const denied = await recordKyc(
      caseId,
      { status: "verified" },
      headers(TENANT_A, ACTOR_A, ["crm_user"]),
    );
    expect(denied.statusCode).toBe(403);
    expect((await getCase(caseId)).kycStatus).toBe("submitted");
  });

  it("rejects an illegal KYC transition with 422", async () => {
    const res = await recordKyc(caseId, { status: "submitted" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_KYC_TRANSITION");
  });

  it("completes once KYC is verified", async () => {
    const verified = await recordKyc(caseId, { status: "verified", reference: "KYC-REF-0001" });
    expect(verified.statusCode).toBe(202);
    const afterKyc = await getCase(caseId);
    expect(afterKyc.kycStatus).toBe("verified");
    expect(afterKyc.kycVerifiedAt).not.toBeNull();

    const completed = await moveStage(caseId, { toStage: "completed" });
    expect(completed.statusCode).toBe(202);

    const final = await getCase(caseId);
    expect(final.stage).toBe("completed");
    expect(final.completedAt).not.toBeNull();
  });

  it("refuses any further transition once completed", async () => {
    const res = await moveStage(caseId, { toStage: "cancelled", reason: REASON });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });
});

describe("onboarding cancellation", () => {
  it("requires a reason of substance and then cancels", async () => {
    const opened = await caseForDeal(DEAL_STAGE);
    expect(opened).toBeDefined();
    const id = opened!.id;

    const bare = await moveStage(id, { toStage: "cancelled" });
    expect(bare.statusCode).toBe(400);
    expect(bare.json().code).toBe("REASON_REQUIRED");
    expect((await getCase(id)).stage).toBe("initiated");

    const cancelled = await moveStage(id, { toStage: "cancelled", reason: REASON });
    expect(cancelled.statusCode).toBe(202);
    const after = await getCase(id);
    expect(after.stage).toBe("cancelled");
    expect(after.cancellationReason).toBe(REASON);
  });
});

describe("onboarding tenant isolation", () => {
  let caseId: string;

  beforeAll(async () => {
    const opened = await caseForDeal(DEAL_MAIN);
    expect(opened).toBeDefined();
    caseId = opened!.id;
  });

  it("tenant B cannot see tenant A's case in a list", async () => {
    const res = await call("GET", "/v1/crm/onboarding-cases?limit=200", {
      headers: headers(TENANT_B, ACTOR_B),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as CaseView[]).map((c) => c.id)).not.toContain(caseId);
  });

  it("tenant B reading tenant A's case by id gets 404, not 403", async () => {
    const res = await call("GET", `/v1/crm/onboarding-cases/${caseId}`, {
      headers: headers(TENANT_B, ACTOR_B),
    });
    expect(res.statusCode).toBe(404);
  });

  it("tenant B cannot move tenant A's case", async () => {
    const res = await call("POST", `/v1/crm/onboarding-cases/${caseId}/stage`, {
      headers: headers(TENANT_B, ACTOR_B),
      payload: { toStage: "cancelled", reason: REASON },
    });
    expect(res.statusCode).toBe(404);
    expect((await getCase(caseId)).stage).toBe("completed");
  });

  it("tenant B cannot record KYC against tenant A's case", async () => {
    const res = await call("POST", `/v1/crm/onboarding-cases/${caseId}/kyc`, {
      headers: headers(TENANT_B, ACTOR_B),
      payload: { status: "submitted" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("a consumer running as tenant B cannot write tenant A's case", async () => {
    const before = await getCase(caseId);
    const handler = captureHandlers().handlerFor(COMMANDS.advanceOnboardingStage);
    const msg = envelope(COMMANDS.advanceOnboardingStage, {
      id: caseId,
      tenantId: TENANT_B,
      toStage: "cancelled",
      fromStage: before.stage,
      cancellationReason: REASON,
      version: before.version,
    }, { tenantId: TENANT_B, actorId: ACTOR_B });

    await runWithTenant(TENANT_B, () => handler(msg));

    expect((await getCase(caseId)).stage).toBe(before.stage);
  });
});

describe("onboarding consumer idempotency", () => {
  it("a redelivered deal-won event does not open a second case", async () => {
    const handler = captureHandlers().handlerFor(EVENTS.dealClosed);
    const messageId = randomUUID();
    const msg = envelope(EVENTS.dealClosed, {
      dealId: DEAL_IDEM, outcome: "won", stage: "Won",
      accountId: ACCOUNT_A, closedValueMinor: "500000",
    }, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });

    await runWithTenant(TENANT_A, () => handler(msg));
    await runWithTenant(TENANT_A, () => handler(msg));

    const rows = (await scoped(TENANT_A, (tx) => tx`
      SELECT id FROM crm.onboarding_cases
      WHERE tenant_id = ${TENANT_A} AND deal_id = ${DEAL_IDEM}
    `)) as unknown as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
  });

  it("a second distinct won event for the same deal still yields one case", async () => {
    // A deal can be both closed-won and stage-moved to Won, producing two events with
    // different messageIds. The (tenant_id, deal_id) unique index is what converges them.
    const handler = captureHandlers().handlerFor(EVENTS.dealStageUpdated);
    const msg = envelope(EVENTS.dealStageUpdated, {
      dealId: DEAL_IDEM, previousStage: "Negotiation", newStage: "Won", accountId: ACCOUNT_A,
    }, { tenantId: TENANT_A, actorId: ACTOR_A });

    await runWithTenant(TENANT_A, () => handler(msg));

    const rows = (await scoped(TENANT_A, (tx) => tx`
      SELECT id FROM crm.onboarding_cases
      WHERE tenant_id = ${TENANT_A} AND deal_id = ${DEAL_IDEM}
    `)) as unknown as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
  });

  it("a redelivered stage command applies exactly once", async () => {
    const opened = await caseForDeal(DEAL_IDEM);
    expect(opened).toBeDefined();
    const id = opened!.id;
    const before = await getCase(id);

    const handler = captureHandlers().handlerFor(COMMANDS.advanceOnboardingStage);
    const messageId = randomUUID();
    const msg = envelope(COMMANDS.advanceOnboardingStage, {
      id,
      tenantId: TENANT_A,
      toStage: "documents_submitted",
      fromStage: before.stage,
      cancellationReason: null,
      version: before.version,
    }, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });

    await runWithTenant(TENANT_A, () => handler(msg));
    await runWithTenant(TENANT_A, () => handler(msg));

    const after = await getCase(id);
    expect(after.stage).toBe("documents_submitted");
    expect(after.version).toBe(before.version + 1);
  });

  it("a redelivered KYC command applies exactly once", async () => {
    const opened = await caseForDeal(DEAL_IDEM);
    const id = opened!.id;
    const before = await getCase(id);

    const handler = captureHandlers().handlerFor(COMMANDS.recordOnboardingKyc);
    const messageId = randomUUID();
    const msg = envelope(COMMANDS.recordOnboardingKyc, {
      id,
      tenantId: TENANT_A,
      toStatus: "submitted",
      fromStatus: before.kycStatus,
      reference: null,
      version: before.version,
    }, { tenantId: TENANT_A, actorId: ACTOR_A, messageId });

    await runWithTenant(TENANT_A, () => handler(msg));
    await runWithTenant(TENANT_A, () => handler(msg));

    const after = await getCase(id);
    expect(after.kycStatus).toBe("submitted");
    expect(after.version).toBe(before.version + 1);
  });
});
