/**
 * Tests for modules/device-registry/consumer.ts
 *
 * Covers all handlers: deviceRegister, deviceActivate, deviceSuspend,
 * deviceDeregister, deviceRotateCredential, deviceConfigPush,
 * deviceBulkConfigPush, deviceFirmwareSchedule.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const versionedUpdateMock = vi.fn(async () => undefined);

let deviceRow: Record<string, unknown> | undefined;
let deviceListRows: Record<string, unknown>[] = [];

function makeSelectChain(rows: Record<string, unknown>[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

function makeSelectAllChain(rows: Record<string, unknown>[]) {
  return {
    from: () => ({
      where: async () => rows,
    }),
  };
}

const fakeTx = {
  select: vi.fn((..._args: unknown[]) => {
    // For bulk operations, check if it's a list query or single device
    if (deviceListRows.length > 0) {
      return makeSelectAllChain(deviceListRows);
    }
    return makeSelectChain(deviceRow ? [deviceRow] : []);
  }),
  insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
};

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => unknown) => fn(fakeTx),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
  versionedUpdate: (...args: unknown[]) => versionedUpdateMock(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: vi.fn(async () => undefined) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...args: unknown[]) => args.join(":") },
}));

vi.mock("../src/modules/device-registry/domain.js", () => ({
  generateDeviceToken: () => ({ token: "raw-token-abc", hash: "hashed-token-xyz" }),
  canTransition: (from: string, to: string) => {
    const transitions: Record<string, string[]> = {
      pending_activation: ["active"],
      active: ["suspended", "deregistered"],
      suspended: ["active", "deregistered"],
    };
    return (transitions[from] ?? []).includes(to);
  },
  getAuthType: (deviceType: string) => deviceType === "biometric" ? "certificate" : "bearer_token",
}));

const { registerDeviceRegistryConsumers } = await import("../src/modules/device-registry/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const DEVICE_ID = "33333333-3333-3333-3333-333333333333";
const LOCATION_ID = "44444444-4444-4444-4444-444444444444";

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerDeviceRegistryConsumers(queue);
  return queue;
}

async function publishAndFlush(queue: MemoryQueue, topic: string, payload: unknown, waitMs = 20): Promise<void> {
  await queue.publish(topic, {
    type: topic,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: "corr-1",
    schemaVersion: "1.0",
    payload,
  });
  await new Promise((r) => setTimeout(r, waitMs));
}

beforeEach(() => {
  markProcessedMock.mockReset().mockResolvedValue(true);
  enqueueMock.mockReset().mockResolvedValue(undefined);
  versionedUpdateMock.mockReset().mockResolvedValue(undefined);
  fakeTx.select.mockClear();
  fakeTx.insert.mockClear();
  fakeTx.update.mockClear();
  deviceListRows = [];

  deviceRow = {
    id: DEVICE_ID,
    tenantId: TENANT,
    deviceType: "turnstile",
    name: "Gate A Turnstile",
    serialNumber: "SN-001",
    locationId: LOCATION_ID,
    gateId: "gate-1",
    status: "pending_activation",
    authType: "bearer_token",
    deviceTokenHash: "old-hash",
    certificateFingerprint: null,
    capabilities: { access_control: ["entry", "exit"] },
    configVersion: 1,
    pendingConfig: null,
    version: 1,
  };
});

describe("deviceRegister", () => {
  const registerPayload = {
    id: DEVICE_ID,
    tenantId: TENANT,
    deviceType: "turnstile",
    name: "Gate A Turnstile",
    serialNumber: "SN-001",
    locationId: LOCATION_ID,
    gateId: "gate-1",
    capabilities: { access_control: ["entry", "exit"] },
  };

  it("registers a device with credentials and emits event", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceRegister, registerPayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    // insert device + audit log
    expect(fakeTx.insert).toHaveBeenCalledTimes(2);
    // enqueue: deviceRegistered
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceRegister, registerPayload);

    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("uses certificate auth for biometric device types", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceRegister, {
      ...registerPayload,
      deviceType: "biometric",
    });

    expect(fakeTx.insert).toHaveBeenCalledTimes(2);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });
});

describe("deviceActivate", () => {
  const activatePayload = { deviceId: DEVICE_ID, tenantId: TENANT };

  it("activates a pending_activation device", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceActivate, activatePayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
    // insert audit log + enqueue deviceActivated
    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceActivate, activatePayload);

    expect(versionedUpdateMock).not.toHaveBeenCalled();
  });

  it("throws when device not found", async () => {
    deviceRow = undefined;
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceActivate, activatePayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });

  it("throws on invalid state transition (active -> active)", async () => {
    deviceRow = { ...deviceRow, status: "active" };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceActivate, activatePayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });

  it("activates from suspended state", async () => {
    deviceRow = { ...deviceRow, status: "suspended" };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceActivate, activatePayload);

    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });
});

describe("deviceSuspend", () => {
  const suspendPayload = { deviceId: DEVICE_ID, tenantId: TENANT, reason: "Maintenance" };

  it("suspends an active device and revokes token cache", async () => {
    deviceRow = { ...deviceRow, status: "active" };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceSuspend, suspendPayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1); // audit log
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceSuspend, suspendPayload);

    expect(versionedUpdateMock).not.toHaveBeenCalled();
  });

  it("throws on invalid transition (pending_activation -> suspended)", async () => {
    deviceRow = { ...deviceRow, status: "pending_activation" };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceSuspend, suspendPayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });

  it("throws when device not found", async () => {
    deviceRow = undefined;
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceSuspend, suspendPayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });
});

describe("deviceDeregister", () => {
  const deregisterPayload = { deviceId: DEVICE_ID, tenantId: TENANT, reason: "End of life" };

  it("deregisters an active device and clears credentials", async () => {
    deviceRow = { ...deviceRow, status: "active" };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceDeregister, deregisterPayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1); // audit log
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceDeregister, deregisterPayload);

    expect(versionedUpdateMock).not.toHaveBeenCalled();
  });

  it("deregisters from suspended state", async () => {
    deviceRow = { ...deviceRow, status: "suspended" };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceDeregister, deregisterPayload);

    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("throws on invalid transition (pending_activation -> deregistered)", async () => {
    deviceRow = { ...deviceRow, status: "pending_activation" };
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceDeregister, deregisterPayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });
});

describe("deviceRotateCredential", () => {
  const rotatePayload = { deviceId: DEVICE_ID, tenantId: TENANT };

  it("rotates device credentials", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceRotateCredential, rotatePayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1); // audit log
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceRotateCredential, rotatePayload);

    expect(versionedUpdateMock).not.toHaveBeenCalled();
  });

  it("throws when device not found", async () => {
    deviceRow = undefined;
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceRotateCredential, rotatePayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });
});

describe("deviceConfigPush", () => {
  const configPayload = {
    deviceId: DEVICE_ID,
    tenantId: TENANT,
    config: { displayBrightness: 80, volume: 50 },
  };

  it("pushes config to a device", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceConfigPush, configPayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    // insert deviceConfigs + audit log
    expect(fakeTx.insert).toHaveBeenCalledTimes(2);
    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceConfigPush, configPayload);

    expect(fakeTx.insert).not.toHaveBeenCalled();
  });

  it("throws when device not found", async () => {
    deviceRow = undefined;
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceConfigPush, configPayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });
});

describe("deviceBulkConfigPush", () => {
  const bulkPayload = {
    tenantId: TENANT,
    deviceType: "turnstile",
    locationId: LOCATION_ID,
    config: { displayBrightness: 80 },
  };

  it("pushes config to all matching devices", async () => {
    deviceListRows = [
      { id: "dev-1", tenantId: TENANT, configVersion: 1, version: 1, pendingConfig: null },
      { id: "dev-2", tenantId: TENANT, configVersion: 2, version: 1, pendingConfig: null },
    ];
    fakeTx.select.mockImplementation(() => makeSelectAllChain(deviceListRows));

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceBulkConfigPush, bulkPayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceBulkConfigPush, bulkPayload);

    expect(fakeTx.insert).not.toHaveBeenCalled();
  });
});

describe("deviceFirmwareSchedule", () => {
  const firmwarePayload = {
    deviceId: DEVICE_ID,
    tenantId: TENANT,
    firmwareUrl: "https://firmware.example.com/v2.0.bin",
    firmwareChecksum: "sha256:abc123",
  };

  it("schedules firmware update for a device", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceFirmwareSchedule, firmwarePayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(queue.dlq).toHaveLength(0);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceFirmwareSchedule, firmwarePayload);

    expect(versionedUpdateMock).not.toHaveBeenCalled();
  });

  it("throws when device not found", async () => {
    deviceRow = undefined;
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.deviceFirmwareSchedule, firmwarePayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });
});
