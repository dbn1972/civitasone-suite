/**
 * VIP-pass audit — privilege-escalation regression tests.
 *
 * Live-verified against the running audit instance (2026-08-25): an
 * "employee"-role JWT (the lowest-privilege role permitted to submit a visit
 * request at all) can POST /v1/visitor/visit-requests with
 * `visitorCategory: "vip"` and receive an immediately `status: "approved"`
 * row — identical in every other field to a control request that, absent
 * the vip flag, correctly lands in `pending_approval`. There is no role
 * check anywhere between the HTTP boundary and the DB insert that restricts
 * who may set `visitorCategory`, so any authenticated employee can grant a
 * visit VIP status for themselves or a guest of their choosing:
 *   - bypasses the normal host-confirmation / approval queue entirely
 *     (Property 27's auto-approve set defaults to {vip} — see
 *     modules/visit-request/domain.ts#resolveInitialStatus, which takes no
 *     actor/role parameter at all),
 *   - triggers modules/vip/domain.ts#resolveVipPrivileges' dedicatedParking
 *     + fastTrack privileges and (per modules/check-in/consumer.ts) an
 *     immediate VIP-arrival alert to the host, on-duty protocol officer, and
 *     reception on check-in.
 *
 * tests/vip-domain.test.ts already covers vip/domain.ts's own logic
 * (resolveVipPrivileges, canViewVipLog) in isolation — that logic is
 * correct. The gap is entirely upstream, at the visit-request HTTP/consumer
 * boundary that feeds it, which is why these tests live here rather than
 * duplicating vip-domain.test.ts. tests/visitor-comprehensive.test.ts even
 * flags this explicitly and left it unaddressed:
 *   "resolveInitialStatus requires the full VisitRequestInput type aligned
 *    to source; VIP/host bypass is validated at the route integration
 *    layer" / "VIP/host bypass is validated at the route integration
 *    layer" — no such route/integration test existed prior to this file
 *    (confirmed: tests/all-routes.test.ts's visit-request POST tests mock
 *    commands.ts entirely and never assert on visitorCategory, and no other
 *    test file publishes a real visitRequestCreate command with
 *    visitorCategory: "vip").
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

  it("the function signature carries no actor/role/requester parameter — category alone decides the bypass", () => {
    // resolveInitialStatus(source, visitorCategory, autoApproveCategories?) — 3 params, none of
    // which identify or authorize the caller. This is the root of the escalation: whoever is
    // ALLOWED to set visitorCategory on the HTTP request (see Part C below — currently "employee",
    // the lowest role that can submit a visit request at all) fully controls the approval bypass.
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

describe("visit-request consumer — visitRequestCreate persists the escalation (mirrors live curl proof)", () => {
  it("an ordinary employee's self-service ('portal') request with visitorCategory='vip' is persisted as status='approved' — no approval step", async () => {
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

  it("the persisted row's visitorCategory is whatever the submitter claimed, unchanged (no server-side normalization/authorization)", async () => {
    const queue = freshQueue();
    await submit(queue, basePayload({ visitorCategory: "vip" }));

    const call = insertValuesMock.mock.calls.at(-1);
    expect((call?.[0] as { visitorCategory?: unknown })?.visitorCategory).toBe("vip");
  });
});

// Part C (route-boundary proof: an "employee" token may POST visitorCategory
// ="vip" and gets 202 not 403, contrasted with vip/log's correct read-side
// gate) lives in tests/vip-privilege-escalation-route.test.ts — it needs the
// REAL app + REAL db (many unrelated route modules pull in shared/db.js's
// full export surface), which is incompatible with this file's db mock.
