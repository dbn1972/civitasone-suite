/**
 * VIP-pass audit — privilege-escalation regression tests.
 *
 * ORIGINAL FINDING (2026-08-25, live-verified against the running audit
 * instance): an "employee"-role JWT (the lowest-privilege role permitted to
 * submit a visit request at all) could POST /v1/visitor/visit-requests with
 * `visitorCategory: "vip"` and receive an immediately `status: "approved"`
 * row — identical in every other field to a control request that, absent
 * the vip flag, correctly lands in `pending_approval`. There was no role
 * check anywhere between the HTTP boundary and the DB insert that restricted
 * who may set `visitorCategory`, so any authenticated employee could grant a
 * visit VIP status for themselves or a guest of their choosing.
 *
 * FIXED: modules/visit-request/routes.ts now gates `visitorCategory: "vip"`
 * behind VIP_GRANT_ROLES (protocol_officer/security_admin/tenant_admin/
 * super_admin) and rejects any other WRITE_ROLES caller with 403 BEFORE
 * `commands.visitRequestCreate` is ever called — i.e. before anything below
 * this comment (resolveInitialStatus, the consumer, the DB insert) is ever
 * reached for an unauthorized vip claim. That HTTP-boundary proof (403 for
 * "employee", 202 for "protocol_officer") lives in
 * tests/vip-privilege-escalation-route.test.ts (Part C).
 *
 * Parts A and B below intentionally still exercise the domain/consumer
 * layers directly (bypassing the HTTP role gate) and their assertions are
 * UNCHANGED on purpose: resolveInitialStatus is a pure function with no
 * actor/role parameter by design (queue command envelopes carry
 * tenantId/actorId/correlationId — see packages/events/src/envelope.ts —
 * but never the actor's roles, so role authorization is structurally only
 * possible once, at the HTTP boundary, while the JWT is still in hand).
 * These lower-layer tests now document the TRUSTED-INPUT contract those
 * layers correctly implement once routes.ts has already authorized a vip
 * request — they are no longer an achievable end-to-end exploit path, since
 * the only producer of `visitRequestCreate` commands (routes.ts) will no
 * longer publish one with visitorCategory: "vip" on behalf of an
 * unauthorized actor. Per the fix-wave instructions these are kept (not
 * deleted) as regression coverage for that trusted-input contract.
 *
 * tests/vip-domain.test.ts already covers vip/domain.ts's own logic
 * (resolveVipPrivileges, canViewVipLog) in isolation — that logic is
 * correct. tests/visitor-comprehensive.test.ts flags the same root cause:
 *   "resolveInitialStatus requires the full VisitRequestInput type aligned
 *    to source; VIP/host bypass is validated at the route integration
 *    layer" — that route/integration coverage now exists in
 *    tests/vip-privilege-escalation-route.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

// ═══════════════════════════════════════════════════════════════════════
// Part A — domain: resolveInitialStatus has no actor/role parameter at all
// ═══════════════════════════════════════════════════════════════════════

import {
  resolveInitialStatus,
  DEFAULT_AUTO_APPROVE_CATEGORIES,
} from "../src/modules/visit-request/domain.js";

describe("visit-request/domain#resolveInitialStatus — no actor/role input (Property 27)", () => {
  it("DEFAULT_AUTO_APPROVE_CATEGORIES contains 'vip' out of the box", () => {
    expect(DEFAULT_AUTO_APPROVE_CATEGORIES.has("vip")).toBe(true);
  });

  it("visitorCategory='vip' auto-approves even from the LEAST trusted source ('portal', self-service, no host pre-registration)", () => {
    expect(resolveInitialStatus("portal", "vip")).toBe("approved");
  });

  it("the exact same request with visitorCategory='standard' requires normal approval from the same source", () => {
    expect(resolveInitialStatus("portal", "standard")).toBe("pending_approval");
  });

  it("the function signature carries no actor/role/requester parameter — category alone decides the bypass (by design: authorization now happens upstream in routes.ts, see Part C)", () => {
    // resolveInitialStatus(source, visitorCategory, autoApproveCategories?) — 3 params, none of
    // which identify or authorize the caller. This was the root of the escalation: previously,
    // WHOEVER was allowed to set visitorCategory on the HTTP request (formerly "employee", the
    // lowest role that can submit a visit request at all) fully controlled the approval bypass.
    // FIXED: routes.ts (VIP_GRANT_ROLES) now restricts who may set visitorCategory: "vip" to
    // protocol_officer/security_admin/tenant_admin/super_admin BEFORE a command ever reaches this
    // function, so resolveInitialStatus itself can safely stay a simple, actor-agnostic pure
    // function — trusting its input is now correct, not a gap.
    expect(resolveInitialStatus.length).toBeLessThanOrEqual(3);
    expect(resolveInitialStatus("kiosk", "vip")).toBe("approved");
    expect(resolveInitialStatus("mobile", "vip")).toBe("approved");
    expect(resolveInitialStatus("host_preregister", "vip")).toBe("approved");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Part B — consumer: the real persisted-row outcome (mirrors the live proof)
// ═══════════════════════════════════════════════════════════════════════

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const getAutoApproveCategoriesMock = vi.fn(async () => DEFAULT_AUTO_APPROVE_CATEGORIES);

const insertValuesMock = vi.fn(async () => undefined);
const fakeTx = {
  insert: vi.fn(() => ({ values: insertValuesMock })),
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: typeof fakeTx) => unknown) => fn(fakeTx) },
}));
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...a: unknown[]) => markProcessedMock(...a),
  enqueue: (...a: unknown[]) => enqueueMock(...a),
}));
vi.mock("../src/modules/config-registry/policy.js", () => ({
  getAutoApproveCategories: (...a: unknown[]) => getAutoApproveCategoriesMock(...a),
}));

const { registerVisitRequestConsumers } = await import("../src/modules/visit-request/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
// The actor is deliberately just "some authenticated employee" — an ordinary
// self-service/host-preregister submitter, not a protocol officer or admin.
const EMPLOYEE_ACTOR = "22222222-2222-2222-2222-222222222222";
const LOCATION_ID = "44444444-4444-4444-4444-444444444444";
const HOST_ID = "77777777-7777-7777-7777-777777777777";

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    tenantId: TENANT,
    locationId: LOCATION_ID,
    visitorName: "AUDIT-VIP-ESCALATION Visitor",
    visitorPhone: "9990001111",
    visitorEmail: null,
    purpose: "audit",
    hostEmployeeId: HOST_ID,
    scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    passType: "single",
    identityDocType: null,
    identityDocRef: null,
    visitorCategory: "standard",
    source: "portal",
    permittedAreas: [],
    createdBy: EMPLOYEE_ACTOR,
    ...overrides,
  };
}

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerVisitRequestConsumers(queue);
  return queue;
}

async function submit(queue: MemoryQueue, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(COMMANDS.visitRequestCreate, {
    type: COMMANDS.visitRequestCreate,
    tenantId: TENANT,
    actorId: EMPLOYEE_ACTOR,
    correlationId: "corr-1",
    schemaVersion: "1.0",
    payload,
  });
  await queue.drain();
}

function insertedStatus(): unknown {
  const call = insertValuesMock.mock.calls.at(-1);
  return (call?.[0] as { status?: unknown } | undefined)?.status;
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  getAutoApproveCategoriesMock.mockReset().mockResolvedValue(DEFAULT_AUTO_APPROVE_CATEGORIES);
  insertValuesMock.mockClear();
});

describe("visit-request consumer — visitRequestCreate trusts an already-authorized visitorCategory (formerly: persisted the escalation unchecked, mirroring the live curl proof)", () => {
  it("a visitRequestCreate command carrying visitorCategory='vip' is persisted as status='approved' — no approval step (in the real system this command can now only originate from routes.ts's VIP_GRANT_ROLES-gated authorized callers; the queue envelope carries no roles for the consumer to re-check, so this remains correct trusted-input behavior)", async () => {
    const queue = freshQueue();
    await submit(queue, basePayload({ visitorCategory: "vip", source: "portal" }));

    expect(insertedStatus()).toBe("approved");
    expect(queue.dlq).toHaveLength(0);
  });

  it("control: the SAME payload with visitorCategory='standard' correctly requires pending_approval", async () => {
    const queue = freshQueue();
    await submit(queue, basePayload({ visitorCategory: "standard", source: "portal" }));

    expect(insertedStatus()).toBe("pending_approval");
  });

  it("the persisted row's visitorCategory is whatever the (now HTTP-authorized) submitter claimed, unchanged (no additional server-side normalization at this layer)", async () => {
    const queue = freshQueue();
    await submit(queue, basePayload({ visitorCategory: "vip" }));

    const call = insertValuesMock.mock.calls.at(-1);
    expect((call?.[0] as { visitorCategory?: unknown })?.visitorCategory).toBe("vip");
  });
});

// Part C (route-boundary proof: an "employee" token gets 403 (FIXED, was 202)
// attempting visitorCategory="vip", a "protocol_officer" token still gets 202,
// contrasted with vip/log's read-side gate) lives in
// tests/vip-privilege-escalation-route.test.ts — it needs the REAL app + REAL
// db (many unrelated route modules pull in shared/db.js's full export
// surface), which is incompatible with this file's db mock.
