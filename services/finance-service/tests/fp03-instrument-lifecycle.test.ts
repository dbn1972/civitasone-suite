/**
 * Cheque / DD lifecycle on CQRS (GAP-FINANCE-TREASURY-CHEQUES-03 / -DETAIL-04, moved route -> command -> consumer).
 *
 * Consumer side (applyIssue / applyTransition): ONE guarded UPDATE + audit in the caller's transaction; replays and
 * lost races write and audit nothing; maker != checker holds on the queue path.
 * Route side (issueInstrument / presentInstrument / ...): read-only pre-checks, then publish a command with a fresh
 * messageId; the route itself never writes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const hoisted = vi.hoisted(() => {
  process.env.FINANCE_COMMAND_WAIT_MS = "0"; // the route answers 202 immediately when nothing applies the command
  return {
    enqueue: vi.fn(), findById: vi.fn(), findByIdTx: vi.fn(), findByNumber: vi.fn(), transitionTx: vi.fn(), insertInstrumentTx: vi.fn(),
    publishCommand: vi.fn(), dbTransaction: vi.fn(),
  };
});
const { enqueue, findById, findByIdTx, findByNumber, transitionTx, insertInstrumentTx, publishCommand } = hoisted;
vi.mock("../src/shared/outbox.js", () => ({ enqueue: hoisted.enqueue }));
vi.mock("../src/shared/db.js", () => ({ db: { transaction: async (cb: (tx: unknown) => unknown) => cb({}) } }));
vi.mock("../src/shared/finance-command.js", () => ({ publishCommand: hoisted.publishCommand }));
vi.mock("../src/modules/instruments/repo.js", () => ({
  findById: hoisted.findById, findByIdTx: hoisted.findByIdTx, findByNumber: hoisted.findByNumber,
  transitionTx: hoisted.transitionTx, insertInstrumentTx: hoisted.insertInstrumentTx,
}));
// present refuses a cheque past its validity horizon (policy-driven); fixtures are dated in 2026, so use a long horizon.
vi.mock("../src/modules/masters/policy.js", () => ({
  getPolicy: async () => ({ vendorMakerChecker: true, auditParaMakerChecker: true, chequeValidityMonths: 120 }),
  readPolicyWith: async () => ({ vendorMakerChecker: true, auditParaMakerChecker: true, chequeValidityMonths: 120 }),
}));

import {
  applyIssue, applyTransition, issueInstrument, presentInstrument, clearInstrument, bounceInstrument, cancelInstrument, assertInstrumentChecker,
} from "../src/modules/instruments/commands.js";

const ISSUER = "issuer-1";
const CHECKER = "checker-2";
const actor = (actorId: string) => ({ tenantId: "t1", actorId, correlationId: "c1" });
const ctxOf = (actorId: string) => actor(actorId) as never;
const row = (status: string, createdBy = ISSUER) => ({
  id: "i1", instrumentType: "cheque", instrumentNo: "000123", bankAccountId: null, bankName: "SBI", payee: "A",
  amountMinor: 100n, currency: "INR", issueDate: "2026-09-01", status, presentedAt: null, clearedAt: null,
  bouncedAt: null, cancelledAt: null, bounceReason: null, paymentId: null, version: 1, createdBy, representCount: 0,
});
const tx = {} as never;
/** audit.event.record rows enqueued (domain events such as finance.instrument.cleared are enqueued alongside). */
const audits = () => enqueue.mock.calls.map((c) => c[1]).filter((e) => e.topic === "audit.event.record");
const body = { instrumentType: "cheque" as const, instrumentNo: "000123", bankName: "SBI", payee: "A", amountMinor: 100, currency: "INR" };

beforeEach(() => {
  for (const f of [enqueue, findById, findByIdTx, findByNumber, transitionTx, insertInstrumentTx, publishCommand]) f.mockReset();
  publishCommand.mockImplementation(async (_c: unknown, _t: string, _p: unknown, id: string) => ({ id, status: "accepted", correlationId: "c1" }));
});
afterEach(() => { delete process.env.FINANCE_INSTRUMENT_MAKER_CHECKER; });

describe("applyTransition: audit of every transition (consumer side)", () => {
  it("present audits once with actor and before/after status", async () => {
    findByIdTx.mockResolvedValue(row("issued"));
    transitionTx.mockResolvedValue(row("presented"));
    await applyTransition(tx, actor(ISSUER), { id: "i1", action: "present" });
    expect(audits()).toHaveLength(1);
    expect(enqueue.mock.calls.map((c) => c[1].topic)).toContain("finance.instrument.presented");
    const evt = audits()[0];
    expect(evt).toMatchObject({ topic: "audit.event.record", actorId: ISSUER });
    expect(evt.payload).toMatchObject({ action: "present", resourceType: "instrument", resourceId: "i1", details: { fromStatus: "issued", toStatus: "presented" } });
  });

  it("clear and bounce audit once each; bounce keeps the reason", async () => {
    findByIdTx.mockResolvedValue(row("presented"));
    transitionTx.mockResolvedValueOnce(row("cleared"));
    await applyTransition(tx, actor(CHECKER), { id: "i1", action: "clear" });
    transitionTx.mockResolvedValueOnce(row("bounced"));
    await applyTransition(tx, actor(CHECKER), { id: "i1", action: "bounce", reason: "Insufficient funds" });
    expect(audits().map((e) => e.payload.action)).toEqual(["clear", "bounce"]);
    expect(transitionTx.mock.calls[1]![5]).toEqual({ bounceReason: "Insufficient funds" });
  });

  it("cancel audits once and records the reason", async () => {
    findByIdTx.mockResolvedValue(row("issued"));
    transitionTx.mockResolvedValue(row("cancelled"));
    await applyTransition(tx, actor("actor-1"), { id: "i1", action: "cancel", reason: "Cheque lost in transit" });
    expect(audits()).toHaveLength(1);
    expect(audits()[0].payload).toMatchObject({ action: "cancel", details: { fromStatus: "issued", toStatus: "cancelled", reason: "Cheque lost in transit" } });
    expect(transitionTx.mock.calls[0]![5]).toEqual({ cancelReason: "Cheque lost in transit" });
  });

  it("an idempotent replay (already in the target state) writes nothing and audits nothing", async () => {
    findByIdTx.mockResolvedValue(row("cleared"));
    await applyTransition(tx, actor(CHECKER), { id: "i1", action: "clear" });
    expect(transitionTx).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("a lost race (guard matches no row, winner applied the same transition) is a quiet no-op, no second audit", async () => {
    findByIdTx.mockResolvedValueOnce(row("issued")).mockResolvedValueOnce(row("cancelled"));
    transitionTx.mockResolvedValue(null);
    await applyTransition(tx, actor("a"), { id: "i1", action: "cancel", reason: "Cheque lost in transit" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("a lost race to a DIFFERENT state is a 409 ILLEGAL_TRANSITION and audits nothing", async () => {
    findByIdTx.mockResolvedValueOnce(row("presented")).mockResolvedValueOnce(row("cleared"));
    transitionTx.mockResolvedValue(null);
    await expect(applyTransition(tx, actor(CHECKER), { id: "i1", action: "bounce", reason: "x" })).rejects.toMatchObject({ status: 409, code: "ILLEGAL_TRANSITION" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("an unknown instrument is a 404; a cancelled instrument cannot be presented (409)", async () => {
    findByIdTx.mockResolvedValueOnce(null);
    await expect(applyTransition(tx, actor(ISSUER), { id: "nope", action: "present" })).rejects.toMatchObject({ status: 404 });
    findByIdTx.mockResolvedValue(row("cancelled"));
    transitionTx.mockResolvedValue(null);
    await expect(applyTransition(tx, actor(ISSUER), { id: "i1", action: "present" })).rejects.toMatchObject({ status: 409, code: "ILLEGAL_TRANSITION" });
  });
});

describe("applyIssue", () => {
  it("audits only when the instrument was actually created, not on an idempotent re-issue", async () => {
    insertInstrumentTx.mockResolvedValueOnce({ row: row("issued"), created: true });
    await applyIssue(tx, actor(ISSUER), body);
    expect(audits()).toHaveLength(1);
    expect(audits()[0].payload).toMatchObject({ action: "issue", details: { toStatus: "issued" } });
    enqueue.mockReset();
    insertInstrumentTx.mockResolvedValueOnce({ row: row("issued"), created: false });
    await applyIssue(tx, actor(ISSUER), body);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("a re-issue with different terms is a 409 conflict and audits nothing", async () => {
    insertInstrumentTx.mockResolvedValueOnce({ row: row("issued"), created: false });
    await expect(applyIssue(tx, actor(ISSUER), { ...body, amountMinor: 999 })).rejects.toMatchObject({ status: 409, code: "INSTRUMENT_CONFLICT" });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("maker-checker on clear and bounce", () => {
  it("consumer refuses the issuer clearing or dishonouring their own instrument (403) before any write", async () => {
    findByIdTx.mockResolvedValue(row("presented", ISSUER));
    await expect(applyTransition(tx, actor(ISSUER), { id: "i1", action: "clear" })).rejects.toMatchObject({ status: 403, code: "MAKER_CHECKER_VIOLATION" });
    await expect(applyTransition(tx, actor(ISSUER), { id: "i1", action: "bounce" })).rejects.toMatchObject({ status: 403, code: "MAKER_CHECKER_VIOLATION" });
    expect(transitionTx).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("the route refuses it immediately too, without publishing", async () => {
    findById.mockResolvedValue(row("presented", ISSUER));
    await expect(clearInstrument(ctxOf(ISSUER), "i1")).rejects.toMatchObject({ status: 403, code: "MAKER_CHECKER_VIOLATION" });
    await expect(bounceInstrument(ctxOf(ISSUER), "i1", {})).rejects.toMatchObject({ status: 403, code: "MAKER_CHECKER_VIOLATION" });
    expect(publishCommand).not.toHaveBeenCalled();
  });

  it("allows a different officer, and does not apply to present", async () => {
    findByIdTx.mockResolvedValue(row("issued", ISSUER));
    transitionTx.mockResolvedValue(row("presented"));
    await expect(applyTransition(tx, actor(ISSUER), { id: "i1", action: "present" })).resolves.toBeUndefined();
    findByIdTx.mockResolvedValue(row("presented", ISSUER));
    transitionTx.mockResolvedValue(row("cleared"));
    await expect(applyTransition(tx, actor(CHECKER), { id: "i1", action: "clear" })).resolves.toBeUndefined();
  });

  it("is always enforced: the former env off-switch no longer has any effect", () => {
    expect(() => assertInstrumentChecker(ISSUER, ISSUER)).toThrow();
    process.env.FINANCE_INSTRUMENT_MAKER_CHECKER = "off";
    expect(() => assertInstrumentChecker(ISSUER, ISSUER)).toThrow();
    expect(() => assertInstrumentChecker(ISSUER, CHECKER)).not.toThrow();
  });
});

describe("route side: pre-check, publish a command with a fresh messageId, never write", () => {
  it("present / clear / bounce / cancel publish one finance.instrument.transition command each (202 when not yet applied)", async () => {
    findById.mockResolvedValue(row("presented"));
    expect(await clearInstrument(ctxOf(CHECKER), "i1")).toMatchObject({ status: "accepted" });
    expect(await bounceInstrument(ctxOf(CHECKER), "i1", { reason: "NSF" })).toMatchObject({ status: "accepted" });
    findById.mockResolvedValue(row("issued"));
    expect(await presentInstrument(ctxOf(ISSUER), "i1")).toMatchObject({ status: "accepted" });
    expect(await cancelInstrument(ctxOf(ISSUER), "i1", { reason: "Cheque lost in transit" })).toMatchObject({ status: "accepted" });
    expect(publishCommand.mock.calls.map((c) => [c[1], c[2].action])).toEqual([
      ["finance.instrument.transition", "clear"], ["finance.instrument.transition", "bounce"],
      ["finance.instrument.transition", "present"], ["finance.instrument.transition", "cancel"],
    ]);
    expect(publishCommand.mock.calls[3]![2]).toMatchObject({ id: "i1", reason: "Cheque lost in transit" });
    expect(transitionTx).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("returns the updated instrument (the original contract) once the consumer has applied the command", async () => {
    findById.mockResolvedValueOnce(row("presented")).mockResolvedValue(row("cleared"));
    process.env.FINANCE_COMMAND_WAIT_MS = "0";
    // the wait deadline is captured at module load (0 ms): one probe still runs, which sees the applied row
    const res = await clearInstrument(ctxOf(CHECKER), "i1");
    expect(res).toMatchObject({ status: "cleared", id: "i1" });
  });

  it("an already-applied transition is returned as-is with nothing published (idempotent)", async () => {
    findById.mockResolvedValue(row("cleared"));
    expect(await clearInstrument(ctxOf(CHECKER), "i1")).toMatchObject({ status: "cleared" });
    expect(publishCommand).not.toHaveBeenCalled();
  });

  it("an illegal transition is an immediate 409 with nothing published", async () => {
    findById.mockResolvedValue(row("cleared"));
    await expect(cancelInstrument(ctxOf(ISSUER), "i1", { reason: "Cheque lost in transit" })).rejects.toMatchObject({ status: 409, code: "ILLEGAL_TRANSITION" });
    expect(publishCommand).not.toHaveBeenCalled();
  });

  it("issue: new number publishes finance.instrument.issue; same terms returns the existing one; other terms is a 409", async () => {
    findByNumber.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    expect(await issueInstrument(ctxOf(ISSUER), body)).toMatchObject({ status: "accepted" });
    expect(publishCommand.mock.calls[0]![1]).toBe("finance.instrument.issue");
    publishCommand.mockClear();
    findByNumber.mockResolvedValue(row("issued"));
    expect(await issueInstrument(ctxOf(ISSUER), body)).toMatchObject({ status: "issued", instrumentNo: "000123" });
    await expect(issueInstrument(ctxOf(ISSUER), { ...body, amountMinor: 999 })).rejects.toMatchObject({ status: 409, code: "INSTRUMENT_CONFLICT" });
    expect(publishCommand).not.toHaveBeenCalled();
  });
});
