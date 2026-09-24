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
  claimApplicationForHireMock,
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
    // BUG-3 fix: atomic application-status claim the hire handler now calls
    // instead of the old blind updateApplication. Defaults to `true`
    // (claim succeeds / not already hired) so the existing happy-path test
    // below keeps its original behavior.
    claimApplicationForHireMock: vi.fn(async () => true),
  };
});

vi.mock("../src/shared/db.js", () => ({
  scopedRead: dbTransactionFn, db: { transaction: dbTransactionFn } }));
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
  // Tx-scoped variant (fix/hrms-batch2-nested-tx-deadlock): applicationHire
  // now reads through its own already-open transaction instead of the
  // scopedRead-based findApplicationById above. Forwarded to the SAME mock.
  findApplicationByIdTx: (...a: any[]) => findApplicationByIdMock(...a),
  // BUG-3 fix: atomic hire claim -- see claimApplicationForHireMock above.
  claimApplicationForHire: (...a: any[]) => claimApplicationForHireMock(...a),
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
  claimApplicationForHireMock.mockResolvedValue(true);
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
  it("claims the application (atomic hire guard), creates employee, and emits employeeCreated", async () => {
    const q = await buildQueue();
    const empId = randomUUID();
    const appId = randomUUID();
    await q.publish(COMMANDS.applicationHire, makeMsg(COMMANDS.applicationHire, {
      employeeId: empId, applicationId: appId, tenantId: TENANT,
      employeeNo: "EMP-NEW-001", dateOfJoining: "2026-08-01",
      basicMinor: 5000000, departmentId: randomUUID(),
      designationId: randomUUID(), employeeType: "permanent",
    }));
    await settle();
    // BUG-3 fix: the hire handler now claims the application atomically
    // (claimApplicationForHire, a guarded UPDATE ... WHERE stage != 'hired')
    // instead of the old blind updateApplication -- see recruitment/repo.ts.
    expect(claimApplicationForHireMock).toHaveBeenCalledOnce();
    expect(claimApplicationForHireMock).toHaveBeenCalledWith(mockTx, appId, TENANT);
    expect(updateApplicationMock).not.toHaveBeenCalled();

    expect(insertEmployeeMock).toHaveBeenCalledOnce();
    const emp = insertEmployeeMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(emp.id).toBe(empId);
    expect(emp.status).toBe("probation");
    expect(emp.fullName).toBe("Ravi Kumar"); // from mocked findApplicationById

    const evt = enqueuedMessages.find((m) => m.topic === EVENTS.employeeCreated);
    expect(evt).toBeDefined();
    await q.stop();
  });

  // BUG-3 regression: a retried/double-clicked Hire action must never create
  // two employee records for the same application. commands.ts now derives a
  // DETERMINISTIC messageId from the applicationId (so a genuine retry is
  // deduped upstream by the queue's own markProcessed) -- but this test
  // simulates the case that fix alone can't cover: two hire commands for the
  // SAME application reaching this consumer under DIFFERENT messageIds (e.g.
  // two independent request-handler invocations before any dedup could kick
  // in). Only the atomic claimApplicationForHire guard added to the consumer
  // protects that case, so this test drives the mock exactly the way the real
  // guarded UPDATE would behave: succeeds once, then reports "already hired".
  it("does not create a second employee when the same application is hired twice under different messageIds", async () => {
    const q = await buildQueue();
    const appId = randomUUID();
    // Mirrors the real guarded UPDATE ... WHERE stage != 'hired': true once,
    // then false for every subsequent attempt on the same application.
    let claimed = false;
    claimApplicationForHireMock.mockImplementation(async () => {
      if (claimed) return false;
      claimed = true;
      return true;
    });

    const basePayload = {
      applicationId: appId, tenantId: TENANT,
      employeeNo: "EMP-NEW-002", dateOfJoining: "2026-08-01",
      basicMinor: 5000000, departmentId: randomUUID(),
      designationId: randomUUID(), employeeType: "permanent",
    };
    // Two distinct messageIds/employeeIds for the SAME applicationId -- what
    // the OLD commands.ts (fresh randomUUID() per call) would have produced
    // for a double-clicked Hire button, and exactly what markProcessed's
    // messageId-keyed dedup cannot catch.
    await q.publish(COMMANDS.applicationHire, makeMsg(COMMANDS.applicationHire, { employeeId: randomUUID(), ...basePayload }));
    await q.publish(COMMANDS.applicationHire, makeMsg(COMMANDS.applicationHire, { employeeId: randomUUID(), ...basePayload }));
    await settle();

    expect(claimApplicationForHireMock).toHaveBeenCalledTimes(2);
    // The critical assertion: only ONE employee record, not two.
    expect(insertEmployeeMock).toHaveBeenCalledOnce();
    const evts = enqueuedMessages.filter((m) => m.topic === EVENTS.employeeCreated);
    expect(evts.length).toBe(1);
    await q.stop();
  });
});
