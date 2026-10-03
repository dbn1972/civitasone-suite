/**
 * Consumer-side regressions in the recruitment F3 write path (invoked directly, no HTTP):
 *  - GAP-RECRUITMENT-CAREERS-PORTAL-LOGIN-03: the careers-portal OTP request must enqueue the sign-in email.
 *  - GAP-RECRUITMENT-DETAIL-09: bulk shortlist must move the application's stage (like the single decision does),
 *    otherwise a bulk-shortlisted row stays "applied" with decision "shortlisted".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NOTIFICATION_SEND } from "@civitasone/events";

const H = vi.hoisted(() => ({
  enqueue: vi.fn(async () => undefined),
  insertChallenge: vi.fn(async () => undefined),
  insertCandidate: vi.fn(async () => undefined),
  findApplicationsByIdsTx: vi.fn(),
  setScreeningById: vi.fn(async () => undefined),
  insertEvent: vi.fn(async () => undefined),
}));

vi.mock("../src/modules/recruitment/audit-emit.js", () => ({ emitAudit: async () => undefined }));
vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));
vi.mock("../src/shared/outbox.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  markProcessed: async () => true,
  enqueue: (...a: unknown[]) => (H.enqueue as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("../src/modules/recruitment/otp-verify-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertChallenge: (...a: unknown[]) => (H.insertChallenge as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("../src/modules/recruitment/candidate-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertCandidate: (...a: unknown[]) => (H.insertCandidate as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("../src/modules/recruitment/screening-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findApplicationsByIdsTx: (...a: unknown[]) => H.findApplicationsByIdsTx(...a),
  setScreeningById: (...a: unknown[]) => (H.setScreeningById as (...x: unknown[]) => unknown)(...a),
  insertEvent: (...a: unknown[]) => (H.insertEvent as (...x: unknown[]) => unknown)(...a),
}));

import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";
import { COMMANDS } from "../src/topics.js";

type Handler = (msg: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, Handler>();
registerF3_recruitment_Consumers({ subscribe: (topic: string, fn: Handler) => { handlers.set(topic, fn); } } as never);

const TENANT = "aaaaaaaa-0003-4000-8000-00000000a003";
const JOB = "bbbbbbbb-0003-4000-8000-00000000b003";
const msg = (payload: Record<string, unknown>) => ({
  messageId: "m-1", tenantId: TENANT, actorId: "aaaaaaaa-0003-4000-8000-0000000000ff", correlationId: "corr-1", payload: { tenantId: TENANT, ...payload },
});
async function run(payload: Record<string, unknown>) {
  const h = handlers.get(COMMANDS.f3RouteWrite);
  if (!h) throw new Error("f3 consumer not registered");
  await h(msg(payload));
}

beforeEach(() => { vi.clearAllMocks(); });

describe("careers-portal OTP request consumer", () => {
  const base = { op: "recruitment_candidate_public_auth_routes__0", id: "cccccccc-0003-4000-8000-00000000c003", candidateId: "dddddddd-0003-4000-8000-00000000d003", isNewCandidate: false, email: "asha@example.com", code: "123456", expiresAt: "2026-10-02T10:10:00.000Z" };

  it("stores the challenge and enqueues the sign-in email with the same code", async () => {
    await run(base);
    expect(H.insertChallenge).toHaveBeenCalledTimes(1);
    expect(H.enqueue).toHaveBeenCalledTimes(1);
    const arg = (H.enqueue.mock.calls[0] as unknown as [unknown, { topic: string; payload: Record<string, unknown> }])[1];
    expect(arg.topic).toBe(NOTIFICATION_SEND);
    expect(arg.payload).toMatchObject({
      recipient: "asha@example.com", channel: "email", eventType: "hrms.candidate.login_otp",
      templateId: "00000000-0000-4000-8001-00000000000d",
      variables: { code: "123456", expiresInMinutes: expect.any(String) },
    });
  });

  it("does not enqueue an email when the code is missing (the write is rejected)", async () => {
    await expect(run({ ...base, code: undefined })).rejects.toThrow(/OTP code is missing/);
    expect(H.enqueue).not.toHaveBeenCalled();
  });
});

describe("bulk shortlist consumer", () => {
  const row = (over: Record<string, unknown>) => ({ id: "x", stage: "applied", screeningDecision: "pending", shortlistFrozen: false, ...over });

  it("moves an applied application's stage to shortlisted along with the decision", async () => {
    H.findApplicationsByIdsTx.mockResolvedValue([row({ id: "a1" })]);
    await run({ op: "recruitment_screening_routes__2", body: { applicationIds: ["a1"] }, params: { id: JOB } });
    expect(H.setScreeningById).toHaveBeenCalledWith(expect.anything(), TENANT, "a1", expect.objectContaining({ screeningDecision: "shortlisted", stage: "shortlisted" }));
  });

  it("does not drag an application that is already further along (offered) back to shortlisted", async () => {
    H.findApplicationsByIdsTx.mockResolvedValue([row({ id: "a2", stage: "offered", screeningDecision: "eligible" })]);
    await run({ op: "recruitment_screening_routes__2", body: { applicationIds: ["a2"] }, params: { id: JOB } });
    const patch = (H.setScreeningById.mock.calls[0] as unknown as [unknown, string, string, Record<string, unknown>])[3];
    expect(patch.screeningDecision).toBe("shortlisted");
    expect(patch).not.toHaveProperty("stage");
  });

  it("does not restamp screened_at when re-shortlisting an already shortlisted row, and advances a missed stage", async () => {
    H.findApplicationsByIdsTx.mockResolvedValue([
      row({ id: "s1", stage: "shortlisted", screeningDecision: "shortlisted" }),
      row({ id: "s2", stage: "screening", screeningDecision: "shortlisted" }),
      row({ id: "s3", stage: "screening", screeningDecision: "pending" }),
    ]);
    await run({ op: "recruitment_screening_routes__2", body: { applicationIds: ["s1", "s2", "s3"] }, params: { id: JOB } });
    const byId = Object.fromEntries(H.setScreeningById.mock.calls.map((c) => [(c as unknown as [unknown, string, string])[2], (c as unknown as [unknown, string, string, Record<string, unknown>])[3]]));
    expect(byId).not.toHaveProperty("s1");               // nothing to change
    expect(byId.s2).toEqual({ stage: "shortlisted" });  // no screenedAt / decision rewrite
    expect(byId.s3).toMatchObject({ screeningDecision: "shortlisted", stage: "shortlisted", screenedAt: expect.any(Date) });
  });

  it("still skips frozen and deliberately decided applications", async () => {
    H.findApplicationsByIdsTx.mockResolvedValue([row({ id: "f", shortlistFrozen: true }), row({ id: "r", screeningDecision: "ineligible" })]);
    await run({ op: "recruitment_screening_routes__2", body: { applicationIds: ["f", "r"] }, params: { id: JOB } });
    expect(H.setScreeningById).not.toHaveBeenCalled();
  });
});
