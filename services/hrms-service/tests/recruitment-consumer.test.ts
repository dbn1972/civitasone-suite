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
  claimApplicationForHireMock, claimApplicationForOfferMock, claimVacancyMock,
  departmentExistsTxMock, designationExistsTxMock, maxOfferVersionTxMock,
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
    // Recruitment hardening (Bug 1): atomic offer-eligibility claim, replaces
    // the old blind updateApplication in the offer handler. Defaults to
    // `true` (offer-eligible) so the happy-path test keeps its original
    // behavior.
    claimApplicationForOfferMock: vi.fn(async () => true),
    // Recruitment hardening (Bug 3): atomic vacancy claim in the hire
    // handler. Defaults to `true` (a vacancy was available) for the same
    // reason.
    claimVacancyMock: vi.fn(async () => true),
    // Recruitment hardening (minor item): department/designation existence
    // checks the hire handler now runs before insertEmployee. Default to
    // `true` (exists) so the happy-path test keeps its original behavior.
    departmentExistsTxMock: vi.fn(async () => true),
    designationExistsTxMock: vi.fn(async () => true),
    // MEDIUM finding (offer write-path consistency): the applicationOffer
    // handler now calls offer-repo.ts's insertOffer/maxOfferVersionTx
    // directly (matching the compliance chain's own module) instead of
    // repo.ts's byte-identical duplicate -- see consumer.ts's doc comment.
    maxOfferVersionTxMock: vi.fn(async () => 0),
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
  // Recruitment hardening (Bug 1): atomic offer-eligibility claim.
  claimApplicationForOffer: (...a: any[]) => claimApplicationForOfferMock(...a),
  // Recruitment hardening (Bug 3): atomic vacancy claim.
  claimVacancy: (...a: any[]) => claimVacancyMock(...a),
}));
vi.mock("../src/modules/employee/repo.js", () => ({
  insertEmployee: (...a: any[]) => insertEmployeeMock(...a),
  // Recruitment hardening (minor item): FK existence checks.
  departmentExistsTx: (...a: any[]) => departmentExistsTxMock(...a),
  designationExistsTx: (...a: any[]) => designationExistsTxMock(...a),
}));
// MEDIUM finding (offer write-path consistency): the applicationOffer
// handler now calls offer-repo.ts directly (the SAME module the compliance
// approval-chain flow uses) rather than repo.ts's byte-identical duplicate
// insertOffer -- see consumer.ts's doc comment on the fix. Routed to the
// SAME insertOfferMock spy above so this file's existing assertions keep
// working unchanged.
vi.mock("../src/modules/recruitment/offer-repo.js", () => ({
  insertOffer: (...a: any[]) => insertOfferMock(...a),
  maxOfferVersionTx: (...a: any[]) => maxOfferVersionTxMock(...a),
}));

import { registerRecruitmentConsumers } from "../src/modules/recruitment/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const JOB = "30000000-cccc-4000-8000-000000000001";

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
  // jobOpeningId included so the Bug-3 vacancy-claim branch (application?.jobOpeningId)
  // is actually exercised by the tests below, not silently skipped.
  findApplicationByIdMock.mockResolvedValue({ applicantName: "Ravi Kumar", email: "ravi@gov.in", mobile: "9876543210", jobOpeningId: JOB });
  claimApplicationForHireMock.mockResolvedValue(true);
  claimApplicationForOfferMock.mockResolvedValue(true);
  claimVacancyMock.mockResolvedValue(true);
  departmentExistsTxMock.mockResolvedValue(true);
  designationExistsTxMock.mockResolvedValue(true);
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
  it("claims the application for offer (atomic guard) and inserts the offer", async () => {
    const q = await buildQueue();
    const appId = randomUUID();
    await q.publish(COMMANDS.applicationOffer, makeMsg(COMMANDS.applicationOffer, {
      offerId: randomUUID(), applicationId: appId, tenantId: TENANT,
      ctcMinor: 6000000, currency: "INR",
    }));
    await settle();
    // Bug 1 fix: the offer handler now claims the application atomically
    // (claimApplicationForOffer, a guarded UPDATE ... WHERE stage/status is
    // offer-eligible) instead of the old blind updateApplication -- see
    // recruitment/repo.ts.
    expect(claimApplicationForOfferMock).toHaveBeenCalledOnce();
    expect(claimApplicationForOfferMock).toHaveBeenCalledWith(mockTx, appId, TENANT);
    expect(updateApplicationMock).not.toHaveBeenCalled();

    expect(insertOfferMock).toHaveBeenCalledOnce();
    const offer = insertOfferMock.mock.calls[0]![1] as Record<string, unknown>;
    // MEDIUM finding: "sent" was never a value offer-domain.ts's vocabulary
    // (draft/pending_approval/approved/returned/released/accepted/declined/
    // withdrawn/expired/revised) defines -- canRelease/isTerminal/
    // isOfferEditable all returned false for it, and POST .../accept,
    // .../decline and .../expire all require status === "released" exactly,
    // so a legacy-flow offer could never legitimately be actioned through
    // those routes. The legacy shortcut has no approval chain, so the
    // honest equivalent is the state the compliance chain reaches right
    // after its own /release step -- with releasedAt genuinely set, and
    // approvedAt correctly left null since no approval actually ran.
    expect(offer.status).toBe("released");
    expect(offer.releasedAt).toBeInstanceOf(Date);
    expect(offer.approvedAt ?? null).toBeNull();
    // Same columns the compliance flow (f3-consumer.ts's
    // "recruitment_offer_routes__0") populates, instead of silently staying
    // at their schema defaults (0 / null) for a legacy-flow offer.
    expect(offer.offerNo).toMatch(/^OFR-/);
    expect(offer.offerVersion).toBe(1);
    expect(offer.basicMinor).toBe(6000000n);
    expect(offer.grossCtcMinor).toBe(6000000n);
    expect(offer.joiningBonusMinor).toBe(0n);
    expect(offer.relocationMinor).toBe(0n);
    expect(offer.variablePayMinor).toBe(0n);
    await q.stop();
  });

  // Bug 1 regression: an application that's withdrawn/rejected/already
  // offered/hired must never get a new offer inserted. This is what a real
  // guarded UPDATE ... WHERE stage NOT IN (...) AND status NOT IN (...)
  // returns 0 rows for -- claimApplicationForOfferMock simulates that.
  it("does not insert an offer when the application is not offer-eligible (withdrawn/rejected/already offered/hired)", async () => {
    claimApplicationForOfferMock.mockResolvedValue(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.applicationOffer, makeMsg(COMMANDS.applicationOffer, {
      offerId: randomUUID(), applicationId: randomUUID(), tenantId: TENANT,
      ctcMinor: 6000000, currency: "INR",
    }));
    await settle();
    expect(insertOfferMock).not.toHaveBeenCalled();
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

    // Bug 3 fix: a vacancy is claimed atomically on the application's job
    // opening BEFORE the employee is created.
    expect(claimVacancyMock).toHaveBeenCalledOnce();
    expect(claimVacancyMock).toHaveBeenCalledWith(mockTx, JOB, TENANT);
    // Minor-item fix: department/designation existence checked before insert.
    expect(departmentExistsTxMock).toHaveBeenCalledOnce();
    expect(designationExistsTxMock).toHaveBeenCalledOnce();

    expect(insertEmployeeMock).toHaveBeenCalledOnce();
    const emp = insertEmployeeMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(emp.id).toBe(empId);
    expect(emp.status).toBe("probation");
    expect(emp.fullName).toBe("Ravi Kumar"); // from mocked findApplicationById

    const evt = enqueuedMessages.find((m) => m.topic === EVENTS.employeeCreated);
    expect(evt).toBeDefined();
    await q.stop();
  });

  // Bug 3 regression: over-hiring beyond the job opening's vacancies must be
  // rejected, not silently create yet another employee against an exhausted
  // opening. claimVacancyMock simulates the real guarded
  // UPDATE ... WHERE vacancies > 0 returning 0 rows.
  it("does not create an employee when the job opening has no vacancy left", async () => {
    claimVacancyMock.mockResolvedValue(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.applicationHire, makeMsg(COMMANDS.applicationHire, {
      employeeId: randomUUID(), applicationId: randomUUID(), tenantId: TENANT,
      employeeNo: "EMP-OVER-001", dateOfJoining: "2026-08-01",
      basicMinor: 5000000, departmentId: randomUUID(),
      designationId: randomUUID(), employeeType: "permanent",
    }));
    await settle();
    expect(claimVacancyMock).toHaveBeenCalledOnce();
    expect(insertEmployeeMock).not.toHaveBeenCalled();
    expect(enqueuedMessages.find((m) => m.topic === EVENTS.employeeCreated)).toBeUndefined();
    await q.stop();
  });

  // Bug 3 regression, concurrency-shaped: two hire attempts for DIFFERENT
  // applications against the SAME job opening's last vacancy. Mirrors the
  // existing "does not create a second employee..." test's stateful-mock
  // style to simulate what the real guarded UPDATE ... WHERE vacancies > 0
  // does under a genuine race -- succeeds exactly once, then reports no
  // vacancy for every other concurrent attempt. See
  // tests/recruitment-hardening-e2e.test.ts for a real-Postgres concurrent
  // version of this same scenario (true row-lock serialization, not a
  // simulated mock).
  it("claims the last vacancy for only ONE of two concurrent hire attempts on the same job opening", async () => {
    let vacancyClaimed = false;
    claimVacancyMock.mockImplementation(async () => {
      if (vacancyClaimed) return false;
      vacancyClaimed = true;
      return true;
    });
    const q = await buildQueue();
    const basePayload = {
      tenantId: TENANT, dateOfJoining: "2026-08-01", basicMinor: 5000000,
      departmentId: randomUUID(), designationId: randomUUID(), employeeType: "permanent",
    };
    await q.publish(COMMANDS.applicationHire, makeMsg(COMMANDS.applicationHire, { employeeId: randomUUID(), applicationId: randomUUID(), employeeNo: "EMP-RACE-A", ...basePayload }));
    await q.publish(COMMANDS.applicationHire, makeMsg(COMMANDS.applicationHire, { employeeId: randomUUID(), applicationId: randomUUID(), employeeNo: "EMP-RACE-B", ...basePayload }));
    await settle();

    expect(claimVacancyMock).toHaveBeenCalledTimes(2);
    // The critical assertion: only ONE of the two concurrent hires actually
    // created an employee against the shared last vacancy.
    expect(insertEmployeeMock).toHaveBeenCalledOnce();
    expect(enqueuedMessages.filter((m) => m.topic === EVENTS.employeeCreated)).toHaveLength(1);
    await q.stop();
  });

  // Minor-item regression: an unknown departmentId must fail fast, not crash
  // past a raw FK-violation, and must not create the employee.
  it("does not create an employee when the department does not exist", async () => {
    departmentExistsTxMock.mockResolvedValue(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.applicationHire, makeMsg(COMMANDS.applicationHire, {
      employeeId: randomUUID(), applicationId: randomUUID(), tenantId: TENANT,
      employeeNo: "EMP-BADDEPT-001", dateOfJoining: "2026-08-01",
      basicMinor: 5000000, departmentId: randomUUID(),
      designationId: randomUUID(), employeeType: "permanent",
    }));
    await settle();
    expect(insertEmployeeMock).not.toHaveBeenCalled();
    await q.stop();
  });

  it("does not create an employee when the designation does not exist", async () => {
    designationExistsTxMock.mockResolvedValue(false);
    const q = await buildQueue();
    await q.publish(COMMANDS.applicationHire, makeMsg(COMMANDS.applicationHire, {
      employeeId: randomUUID(), applicationId: randomUUID(), tenantId: TENANT,
      employeeNo: "EMP-BADDESIG-001", dateOfJoining: "2026-08-01",
      basicMinor: 5000000, departmentId: randomUUID(),
      designationId: randomUUID(), employeeType: "permanent",
    }));
    await settle();
    expect(insertEmployeeMock).not.toHaveBeenCalled();
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
