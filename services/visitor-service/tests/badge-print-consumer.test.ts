/**
 * Tests for modules/badge-print/consumer.ts
 *
 * Covers all handlers: printJobCreate, printJobAcknowledge, printJobFail,
 * printJobRetry, printJobRequeue, badgeTemplateCreate, badgeTemplateUpdate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryQueue } from "@civitasone/queue";

const markProcessedMock = vi.fn(async () => true);
const enqueueMock = vi.fn(async () => undefined);
const versionedUpdateMock = vi.fn(async () => undefined);

// Track what table is queried
let templateRow: Record<string, unknown> | undefined;
let passRow: Record<string, unknown> | undefined;
let visitRow: Record<string, unknown> | undefined;
let printJobRow: Record<string, unknown> | undefined;

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
    // The order of selects in printJobCreate: template, pass, visit
    if (selectCallIdx === 1) return makeSelectChain(templateRow ? [templateRow] : []);
    if (selectCallIdx === 2) return makeSelectChain(passRow ? [passRow] : []);
    if (selectCallIdx === 3) return makeSelectChain(visitRow ? [visitRow] : []);
    // For other handlers: printJobRow
    return makeSelectChain(printJobRow ? [printJobRow] : []);
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

vi.mock("../src/modules/badge-print/renderer.js", () => ({
  renderBadge: (_body: string, _data: unknown) => "RENDERED_ZPL_PAYLOAD",
  validateTemplatePlaceholders: (body: string) => {
    if (body.includes("{{invalid}}")) return { valid: false, invalidPlaceholders: ["invalid"] };
    return { valid: true, invalidPlaceholders: [] };
  },
}));

vi.mock("../src/modules/badge-print/domain.js", () => ({
  computeJobScore: (_priority: string, _now: Date) => 100,
  shouldRetry: (retryCount: number) => retryCount < 3,
  computeNextRetryAt: (_retryCount: number, _now: Date) => new Date("2025-06-15T12:00:00Z"),
  createNewVersion: (current: { templateVersion: number; id: string }) => ({
    templateVersion: current.templateVersion + 1,
    previousVersionId: current.id,
  }),
}));

vi.mock("ioredis", () => ({
  Redis: vi.fn(() => null),
}));

const { registerBadgePrintConsumers } = await import("../src/modules/badge-print/consumer.js");
const { COMMANDS } = await import("../src/topics.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const TEMPLATE_ID = "33333333-3333-3333-3333-333333333333";
const PASS_ID = "44444444-4444-4444-4444-444444444444";
const VISIT_ID = "55555555-5555-5555-5555-555555555555";
const JOB_ID = "66666666-6666-6666-6666-666666666666";
const DEVICE_ID = "77777777-7777-7777-7777-777777777777";

function freshQueue(): MemoryQueue {
  const queue = new MemoryQueue();
  registerBadgePrintConsumers(queue);
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
  selectCallIdx = 0;

  templateRow = {
    id: TEMPLATE_ID,
    tenantId: TENANT,
    name: "Standard Badge",
    printerLanguage: "zpl",
    templateBody: "^XA{{visitor_name}}^XZ",
    badgeWidthMm: 86,
    badgeHeightMm: 54,
    visitorCategory: "standard",
    status: "active",
    templateVersion: 1,
    version: 1,
  };

  passRow = {
    id: PASS_ID,
    tenantId: TENANT,
    visitRequestId: VISIT_ID,
    locationId: "loc-1",
    passNumber: "VP-001",
    qrJwt: "jwt-token",
    permittedAreas: ["area-1", "area-2"],
    validFrom: new Date("2025-06-15T08:00:00Z"),
    validUntil: new Date("2025-06-15T18:00:00Z"),
    status: "active",
  };

  visitRow = {
    id: VISIT_ID,
    tenantId: TENANT,
    visitorName: "Jane Doe",
    hostEmployeeId: "host-1",
    visitorCategory: "standard",
  };

  printJobRow = {
    id: JOB_ID,
    tenantId: TENANT,
    deviceId: DEVICE_ID,
    passId: PASS_ID,
    templateId: TEMPLATE_ID,
    status: "queued",
    priority: "standard",
    retryCount: 0,
    version: 1,
  };
});

describe("printJobCreate", () => {
  const createPayload = {
    id: JOB_ID,
    tenantId: TENANT,
    passId: PASS_ID,
    deviceId: DEVICE_ID,
    priority: "standard",
    printerLanguage: "zpl",
    visitorCategory: "standard",
  };

  it("creates a print job with rendered badge data", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobCreate, createPayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
    // enqueue: printJobCreated
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobCreate, createPayload);

    expect(fakeTx.insert).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("throws when no badge template found", async () => {
    templateRow = undefined;
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobCreate, createPayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });

  it("throws when digital pass not found", async () => {
    passRow = undefined;
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobCreate, createPayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });

  it("throws when visit request not found", async () => {
    visitRow = undefined;
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobCreate, createPayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });
});

describe("printJobAcknowledge", () => {
  const ackPayload = { jobId: JOB_ID, deviceId: DEVICE_ID, tenantId: TENANT };

  it("marks job as completed and emits event", async () => {
    // For acknowledge, the first select returns the print job
    selectCallIdx = 0;
    fakeTx.select.mockImplementation(() => {
      selectCallIdx++;
      return makeSelectChain(printJobRow ? [printJobRow] : []);
    });

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobAcknowledge, ackPayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobAcknowledge, ackPayload);

    expect(versionedUpdateMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("throws when print job not found", async () => {
    fakeTx.select.mockImplementation(() => makeSelectChain([]));
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobAcknowledge, ackPayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });
});

describe("printJobFail", () => {
  const failPayload = {
    jobId: JOB_ID,
    deviceId: DEVICE_ID,
    tenantId: TENANT,
    errorCode: "PAPER_OUT",
    errorMessage: "Printer is out of paper",
  };

  it("retries when retry count is below threshold", async () => {
    fakeTx.select.mockImplementation(() =>
      makeSelectChain(printJobRow ? [printJobRow] : []),
    );

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobFail, failPayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
    // enqueue: printJobFailed event only (no notification when retrying)
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("marks as failed and notifies when max retries reached", async () => {
    printJobRow = { ...printJobRow, retryCount: 3 };
    fakeTx.select.mockImplementation(() =>
      makeSelectChain(printJobRow ? [printJobRow] : []),
    );

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobFail, failPayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
    // enqueue: notification + printJobFailed event
    expect(enqueueMock).toHaveBeenCalledTimes(2);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobFail, failPayload);

    expect(versionedUpdateMock).not.toHaveBeenCalled();
  });
});

describe("printJobRetry", () => {
  const retryPayload = { jobId: JOB_ID, deviceId: DEVICE_ID, tenantId: TENANT };

  it("re-queues the job", async () => {
    fakeTx.select.mockImplementation(() =>
      makeSelectChain(printJobRow ? [printJobRow] : []),
    );

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobRetry, retryPayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobRetry, retryPayload);

    expect(versionedUpdateMock).not.toHaveBeenCalled();
  });
});

describe("printJobRequeue", () => {
  const requeuePayload = {
    jobId: JOB_ID,
    deviceId: "new-device-id",
    tenantId: TENANT,
    reason: "Original printer offline",
  };

  it("reassigns job to a different device", async () => {
    fakeTx.select.mockImplementation(() =>
      makeSelectChain(printJobRow ? [printJobRow] : []),
    );

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobRequeue, requeuePayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.printJobRequeue, requeuePayload);

    expect(versionedUpdateMock).not.toHaveBeenCalled();
  });
});

describe("badgeTemplateCreate", () => {
  const createPayload = {
    id: TEMPLATE_ID,
    tenantId: TENANT,
    name: "VIP Badge",
    printerLanguage: "zpl",
    templateBody: "^XA{{visitor_name}}^XZ",
    badgeWidthMm: 86,
    badgeHeightMm: 54,
    visitorCategory: "vip",
  };

  it("creates a badge template", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.badgeTemplateCreate, createPayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.badgeTemplateCreate, createPayload);

    expect(fakeTx.insert).not.toHaveBeenCalled();
  });

  it("throws when template has invalid placeholders", async () => {
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.badgeTemplateCreate, {
      ...createPayload,
      templateBody: "^XA{{invalid}}^XZ",
    }, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });
});

describe("badgeTemplateUpdate", () => {
  const updatePayload = {
    templateId: TEMPLATE_ID,
    tenantId: TENANT,
    name: "Updated Badge",
    templateBody: null,
    badgeWidthMm: null,
    badgeHeightMm: null,
    visitorCategory: null,
  };

  it("creates a new version and archives the old one", async () => {
    fakeTx.select.mockImplementation(() =>
      makeSelectChain(templateRow ? [templateRow] : []),
    );

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.badgeTemplateUpdate, updatePayload);

    expect(markProcessedMock).toHaveBeenCalledTimes(1);
    // insert new version + versionedUpdate to archive old
    expect(fakeTx.insert).toHaveBeenCalledTimes(1);
    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("does not process on idempotent replay", async () => {
    markProcessedMock.mockResolvedValue(false);
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.badgeTemplateUpdate, updatePayload);

    expect(fakeTx.insert).not.toHaveBeenCalled();
  });

  it("throws when template not found", async () => {
    fakeTx.select.mockImplementation(() => makeSelectChain([]));
    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.badgeTemplateUpdate, updatePayload, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });

  it("validates placeholders when templateBody is updated", async () => {
    fakeTx.select.mockImplementation(() =>
      makeSelectChain(templateRow ? [templateRow] : []),
    );

    const queue = freshQueue();
    await publishAndFlush(queue, COMMANDS.badgeTemplateUpdate, {
      ...updatePayload,
      templateBody: "^XA{{invalid}}^XZ",
    }, 600);

    expect(queue.dlq.length).toBeGreaterThan(0);
  });
});
