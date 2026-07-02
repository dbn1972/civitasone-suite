/**
 * Recruitment consumer unit tests — mock-based (no real DB).
 * Covers: jobCreate, applicationCreate, applicationOffer, applicationHire.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const {
  mockTx, dbTransactionFn, enqueuedMessages,
  insertJobOpeningMock, insertApplicationMock, updateApplicationMock,
  insertOfferMock, findApplicationByIdMock, insertEmployeeMock,
} = vi.hoisted(() => {
  const _mockTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    insertJobOpeningMock: vi.fn(async () => undefined),
    insertApplicationMock: vi.fn(async () => undefined),
    updateApplicationMock: vi.fn(async () => undefined),
    insertOfferMock: vi.fn(async () => undefined),
    findApplicationByIdMock: vi.fn(async () => null as any),
    insertEmployeeMock: vi.fn(async () => undefined),
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => {
    enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
  }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...parts: string[]) => parts.join(":") },
}));
vi.mock("../src/modules/recruitment/repo.js", () => ({
  insertJobOpening: (...a: any[]) => insertJobOpeningMock(...a),
  insertApplication: (...a: any[]) => insertApplicationMock(...a),
  updateApplication: (...a: any[]) => updateApplicationMock(...a),
  insertOffer: (...a: any[]) => insertOfferMock(...a),
  findApplicationById: (...a: any[]) => findApplicationByIdMock(...a),
}));
vi.mock("../src/modules/employee/repo.js", () => ({
  insertEmployee: (...a: any[]) => insertEmployeeMock(...a),
}));

import { registerRecruitmentConsumers } from "../src/modules/recruitment/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerRecruitmentConsumers(q);
  await q.start();
  return q;
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  findApplicationByIdMock.mockResolvedValue({ applicantName: "Ravi Kumar", email: "ravi@gov.in", mobile: "9876543210" });
});

describe("jobCreate command", () => {
  it("inserts a job opening with status 'open'", async () => {
    const q = await buildQueue();
    const jobId = randomUUID();
    await q.publish(COMMANDS.jobCreate, makeMsg(COMMANDS.jobCreate, {
      id: jobId, tenantId: TENANT, refNo: "RCT/2026/001", title: "Senior Clerk",
      departmentId: randomUUID(), vacancies: 5,
    }));
    await settle();
    expect(insertJobOpeningMock).toHaveBeenCalledOnce();
    const row = insertJobOpeningMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.id).toBe(jobId);
    expect(row.status).toBe("open");
    expect(row.vacancies).toBe(5);
    await q.stop();
  });
});

describe("applicationCreate command", () => {
  it("inserts an application with stage 'applied'", async () => {
    const q = await buildQueue();
    const appId = randomUUID();
    await q.publish(COMMANDS.applicationCreate, makeMsg(COMMANDS.applicationCreate, {
      id: appId, tenantId: TENANT, jobOpeningId: randomUUID(),
      applicantName: "Test Applicant", email: "test@example.com",
    }));
    await settle();
    expect(insertApplicationMock).toHaveBeenCalledOnce();
    const row = insertApplicationMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.stage).toBe("applied");
    expect(row.status).toBe("active");
    await q.stop();
  });
});

describe("applicationOffer command", () => {
  it("updates application stage to 'offered' and inserts offer", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.applicationOffer, makeMsg(COMMANDS.applicationOffer, {
      offerId: randomUUID(), applicationId: randomUUID(), tenantId: TENANT,
      ctcMinor: 6000000, currency: "INR",
    }));
    await settle();
    expect(updateApplicationMock).toHaveBeenCalledOnce();
    expect(insertOfferMock).toHaveBeenCalledOnce();
    const offer = insertOfferMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(offer.status).toBe("sent");
    await q.stop();
  });
});

describe("applicationHire command", () => {
  it("creates employee, closes application, and emits employeeCreated", async () => {
    const q = await buildQueue();
    const empId = randomUUID();
    await q.publish(COMMANDS.applicationHire, makeMsg(COMMANDS.applicationHire, {
      employeeId: empId, applicationId: randomUUID(), tenantId: TENANT,
      employeeNo: "EMP-NEW-001", dateOfJoining: "2026-08-01",
      basicMinor: 5000000, departmentId: randomUUID(),
      designationId: randomUUID(), employeeType: "permanent",
    }));
    await settle();
    expect(updateApplicationMock).toHaveBeenCalledOnce();
    const [, appId, appPatch] = updateApplicationMock.mock.calls[0]! as [unknown, string, Record<string, unknown>];
    expect(appPatch.stage).toBe("hired");

    expect(insertEmployeeMock).toHaveBeenCalledOnce();
    const emp = insertEmployeeMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(emp.id).toBe(empId);
    expect(emp.status).toBe("probation");
    expect(emp.fullName).toBe("Ravi Kumar"); // from mocked findApplicationById

    const evt = enqueuedMessages.find((m) => m.topic === EVENTS.employeeCreated);
    expect(evt).toBeDefined();
    await q.stop();
  });
});
