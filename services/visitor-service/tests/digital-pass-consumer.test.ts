/**
 * Tests for modules/digital-pass/consumer.ts
 *
 * Covers all handlers: passGenerate, passRevoke, passReplace.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const addToRevokedSetMock = vi.fn(async () => undefined);

let passRow: Record<string, unknown> | undefined;
let visitRow: Record<string, unknown> | undefined;

let selectCallIdx = 0;

function makeSelectChain(rows: Record<string, unknown>[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

const fakeTx = {
  select: vi.fn(() => {
    selectCallIdx++;
    // passGenerate: visitRow lookup comes after insert
    // passRevoke: passRow
    // passReplace: passRow then visitRow
    if (selectCallIdx === 1) return makeSelectChain(passRow ? [passRow] : []);
    return makeSelectChain(visitRow ? [visitRow] : []);
  }),
  insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => undefined),
    })),
  })),
};

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => unknown) => fn(fakeTx),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: unknown[]) => markProcessedMock(...args),
  enqueue: (...args: unknown[]) => enqueueMock(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: vi.fn(async () => undefined) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...args: unknown[]) => args.join(":") },
}));

vi.mock("../src/modules/digital-pass/domain.js", () => ({
  generatePass: async (_params: unknown, _key: string) => ({
    passNumber: "VP-20250615-001",
    qrJwt: "signed-jwt-token",
    validFrom: new Date("2025-06-15T08:00:00Z"),
    validUntil: new Date("2025-06-15T18:00:00Z"),
  }),
  revokePass: (_pass: unknown, reason: string) => ({
    revoked: true,
    revokedAt: new Date("2025-06-15T12:00:00Z"),
    revokeReason: reason,
  }),
  replacePass: async (_params: unknown, _key: string) => ({
    passNumber: "VP-20250615-002",
    qrJwt: "new-signed-jwt-token",
    validFrom: new Date("2025-06-15T08:00:00Z"),
    validUntil: new Date("2025-06-15T18:00:00Z"),
  }),
  computeValidityWindow: (_type: string, from: Date, until: Date, _caps: unknown) => ({
    validFrom: from,
    validUntil: until,
  }),
}));

vi.mock("../src/modules/digital-pass/revocation-store.js", () => ({
  addToRevokedSet: (...args: unknown[]) => addToRevokedSetMock(...args),
}));

vi.mock("../src/modules/config-registry/policy.js", () => ({
  getPolicyNumber: async () => 7,
  MS_PER_DAY: 86_400_000,
}));

const { registerDigitalPassConsumers } = await import("../src/modules/digital-pass/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const PASS_ID = "33333333-3333-3333-3333-333333333333";
const NEW_PASS_ID = "44444444-4444-4444-4444-444444444444";
const VISIT_ID = "55555555-5555-5555-5555-555555555555";
const LOCATION_ID = "66666666-6666-6666-6666-666666666666";

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerDigitalPassConsumers(queue);
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
  addToRevokedSetMock.mockReset().mockResolvedValue(undefined);
  fakeTx.select.mockClear();
  fakeTx.insert.mockClear();
  fakeTx.update.mockClear();
  selectCallIdx = 0;

  passRow = {
    id: PASS_ID,
    tenantId: TENANT,
    visitRequestId: VISIT_ID,
    locationId: LOCATION_ID,
    passNumber: "VP-001",
    status: "active",
    passType: "single",
    qrJwt: "old-jwt",
    validFrom: new Date("2025-06-15T08:00:00Z"),
    validUntil: new Date("2025-06-15T18:00:00Z"),
    permittedAreas: ["area-1"],
    revoked: false,
    escortEmployeeId: null,
    createdBy: ACTOR,
  };

  visitRow = {
    id: VISIT_ID,
    tenantId: TENANT,
    visitorName: "Jane Visitor",
    visitorPhone: "9876543210",
    visitorEmail: "jane@example.com",
  };
});

describe("passGenerate", () => {
  const generatePayload = {
    id: PASS_ID,
    tenantId: TENANT,
    visitRequestId: VISIT_ID,
    visitorId: ACTOR,
    locationId: LOCATION_ID,
    passType: "single",
    validFrom: "2025-06-15T08:00:00Z",
    validUntil: "2025-06-15T18:00:00Z",
    permittedAreas: ["area-1"],
    tenantPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
  };

  it("generates a pass and sends notifications", async () => {
    // For passGenerate: first select is the visitRow (after insert)
    fakeTx.select.mockImplementation(() => {
      selectCallIdx++;
      return makeSelectChain(visitRow ? [visitRow] : []);
    });

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passGenerate, generatePayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1); // digital pass
    // enqueue: passGenerated + email notification + sms notification
    expect(enqueueMock).toHaveBeenCalledTimes(3);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passGenerate, generatePayload);

    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("skips email notification when no email", async () => {
    visitRow = { ...visitRow, visitorEmail: "" };
    fakeTx.select.mockImplementation(() => {
      selectCallIdx++;
      return makeSelectChain(visitRow ? [visitRow] : []);
    });

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passGenerate, generatePayload);

    // passGenerated + sms only (no email)
    expect(enqueueMock).toHaveBeenCalledTimes(2);
  });

  it("skips SMS notification when no phone", async () => {
    visitRow = { ...visitRow, visitorPhone: "" };
    fakeTx.select.mockImplementation(() => {
      selectCallIdx++;
      return makeSelectChain(visitRow ? [visitRow] : []);
    });

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passGenerate, generatePayload);

    // passGenerated + email only (no sms)
    expect(enqueueMock).toHaveBeenCalledTimes(2);
  });
});

describe("passRevoke", () => {
  const revokePayload = {
    passId: PASS_ID,
    reason: "Security concern",
    tenantId: TENANT,
  };

  it("revokes a pass and adds to revocation set", async () => {
    fakeTx.select.mockImplementation(() => makeSelectChain(passRow ? [passRow] : []));

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passRevoke, revokePayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    // enqueue: passRevoked
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(addToRevokedSetMock).toHaveBeenCalledWith(TENANT, PASS_ID);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passRevoke, revokePayload);

    expect(enqueueMock).not.toHaveBeenCalled();
    expect(addToRevokedSetMock).not.toHaveBeenCalled();
  });

  it("throws when pass not found", async () => {
    fakeTx.select.mockImplementation(() => makeSelectChain([]));
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passRevoke, revokePayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });

  it("gracefully handles Redis revocation set failure", async () => {
    fakeTx.select.mockImplementation(() => makeSelectChain(passRow ? [passRow] : []));
    addToRevokedSetMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passRevoke, revokePayload);

    // Revocation still committed to DB
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(queue.dlq).toHaveLength(0);
  });
});

describe("passReplace", () => {
  const replacePayload = {
    originalPassId: PASS_ID,
    newPassId: NEW_PASS_ID,
    reason: "Lost badge",
    tenantId: TENANT,
    tenantPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
  };

  it("revokes original, generates replacement, and notifies", async () => {
    fakeTx.select.mockImplementation(() => {
      selectCallIdx++;
      if (selectCallIdx === 1) return makeSelectChain(passRow ? [passRow] : []);
      return makeSelectChain(visitRow ? [visitRow] : []);
    });

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passReplace, replacePayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    // insert: new pass
    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
    // enqueue: passReplaced + sms notification
    expect(enqueueMock).toHaveBeenCalledTimes(2);
    // Post-commit: add original to revocation set
    expect(addToRevokedSetMock).toHaveBeenCalledWith(TENANT, PASS_ID);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passReplace, replacePayload);

    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(addToRevokedSetMock).not.toHaveBeenCalled();
  });

  it("throws when original pass not found", async () => {
    fakeTx.select.mockImplementation(() => makeSelectChain([]));
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passReplace, replacePayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });

  it("gracefully handles Redis failure on revocation set", async () => {
    fakeTx.select.mockImplementation(() => {
      selectCallIdx++;
      if (selectCallIdx === 1) return makeSelectChain(passRow ? [passRow] : []);
      return makeSelectChain(visitRow ? [visitRow] : []);
    });
    addToRevokedSetMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passReplace, replacePayload);

    // Replace still committed to DB
    expect(enqueueMock).toHaveBeenCalled();
    expect(queue.dlq).toHaveLength(0);
  });

  it("skips SMS when visitor has no phone", async () => {
    visitRow = { ...visitRow, visitorPhone: "" };
    fakeTx.select.mockImplementation(() => {
      selectCallIdx++;
      if (selectCallIdx === 1) return makeSelectChain(passRow ? [passRow] : []);
      return makeSelectChain(visitRow ? [visitRow] : []);
    });

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.passReplace, replacePayload);

    // passReplaced only (no sms)
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });
});
