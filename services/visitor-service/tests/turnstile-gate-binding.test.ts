/**
 * turnstile-control routes — a device's reported passage/tailgating events
 * are now checked against the gate it is actually bound to (Fix 5).
 *
 * BUSINESS-LOGIC / SECURITY AUDIT FINDING, now fixed (was MEDIUM — device/
 * gate binding not enforced): device-auth.ts resolves and binds
 * `deviceContext.gateId` (the gate the authenticated device is registered
 * against — device-registry's `devices.gate_id` column) onto every
 * authenticated device request. `turnstile-control/routes.ts`'s passage and
 * tailgating handlers used to take `gateId` from the CLIENT-SUPPLIED
 * request body (validators.ts#passageEventBody/tailgatingBody) and pass it
 * straight through to `publishPassageRecord` — neither handler compared
 * `body.gateId` to `deviceCtx.gateId`. A device authenticated for Gate A
 * could report passage/tailgating events (and, for `direction: "in"`,
 * trigger a downstream `visitor.check_in.record` command) for ANY gateId
 * string, including a gate it had no physical relationship to, as long as
 * it was within the device's own tenant.
 *
 * The fix (turnstile-control/routes.ts): both handlers now reject with 403
 * GATE_BINDING_MISMATCH before publishing anything when `body.gateId !==
 * deviceCtx.gateId`. A companion consumer-level check
 * (turnstile-control/consumer.ts) provides defense in depth — see
 * `turnstile-cross-gate-checkin.integration.test.ts` for the real-DB,
 * end-to-end proof.
 *
 * Builds a minimal standalone app registering ONLY turnstileControlRoutes,
 * mocking just its direct dependencies — matching the scoped-mock,
 * lightweight-app convention used by device-auth.test.ts (direct middleware
 * invocation) and all-routes.test.ts (full-app inject), sized down to avoid
 * pulling in the unrelated mocks app.js would otherwise require.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

const TENANT = randomUUID();
const DEVICE_ID = randomUUID();
const GATE_A = randomUUID(); // the device's ACTUAL bound gate
const GATE_B = randomUUID(); // an unrelated gate in the same tenant
const PASS_ID = randomUUID();

const publishPassageRecordMock = vi.fn(async (_ctx: unknown, input: { gateId: string }) => ({
  id: randomUUID(), status: "accepted", correlationId: "corr-1",
}));

vi.mock("../src/modules/turnstile-control/commands.js", () => ({
  publishPassageRecord: (...args: unknown[]) => publishPassageRecordMock(...(args as [unknown, { gateId: string }])),
  publishEmergencyUnlock: vi.fn(),
  publishEmergencyRestore: vi.fn(),
  publishOfflineSync: vi.fn(),
}));
vi.mock("../src/modules/turnstile-control/command-queue.js", () => ({
  dequeueCommand: vi.fn(async () => null),
}));
vi.mock("../src/modules/turnstile-control/repo.js", () => ({
  clearAntiPassbackState: vi.fn(async () => undefined),
  updateCommandStatus: vi.fn(async () => undefined),
}));
// The device authenticates successfully and is bound to GATE_A — this is
// the ONLY gate it should ever be able to report events for.
vi.mock("../src/modules/device-registry/device-auth.js", () => ({
  deviceAuth: vi.fn(async (req: any) => {
    req.deviceContext = {
      deviceId: DEVICE_ID, tenantId: TENANT, locationId: "loc-1",
      gateId: GATE_A, deviceType: "scanner", authType: "bearer_token",
    };
  }),
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { default: turnstileControlRoutes } = await import("../src/modules/turnstile-control/routes.js");
  app = Fastify();
  await app.register(turnstileControlRoutes);
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(() => { publishPassageRecordMock.mockClear(); });

describe("turnstile-control routes — device/gate binding is enforced (Fix 5)", () => {
  it("a device bound to GATE_A is rejected (403) reporting a passage event for an unrelated GATE_B", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/visitor/turnstiles/passage",
      payload: {
        passId: PASS_ID,
        gateId: GATE_B, // does NOT match deviceContext.gateId (GATE_A)
        direction: "in",
        passageCount: 1,
        eventTimestamp: new Date().toISOString(),
        offlineRecorded: false,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(publishPassageRecordMock).not.toHaveBeenCalled();
  });

  it("the same device correctly reporting its OWN gate (GATE_A) is accepted", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/visitor/turnstiles/passage",
      payload: {
        passId: PASS_ID,
        gateId: GATE_A, // matches deviceContext.gateId
        direction: "in",
        passageCount: 1,
        eventTimestamp: new Date().toISOString(),
        offlineRecorded: false,
      },
    });

    expect(res.statusCode).toBe(202);
    expect(publishPassageRecordMock).toHaveBeenCalledTimes(1);
    expect(publishPassageRecordMock.mock.calls[0]?.[1]).toMatchObject({ gateId: GATE_A });
  });

  it("the same enforcement applies to tailgating reports", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/visitor/turnstiles/tailgating",
      payload: { passId: PASS_ID, gateId: GATE_B, passageCount: 2 },
    });

    expect(res.statusCode).toBe(403);
    expect(publishPassageRecordMock).not.toHaveBeenCalled();
  });
});
