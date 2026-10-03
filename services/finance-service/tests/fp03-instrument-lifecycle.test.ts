/**
 * GAP-FINANCE-TREASURY-CHEQUES-03 -- cheque / DD lifecycle: every bank-outcome transition (and the
 * issue) is audited exactly once, and clearing or dishonouring an instrument is maker-checker.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const enqueue = vi.hoisted(() => vi.fn());
const findById = vi.hoisted(() => vi.fn());
const transitionTx = vi.hoisted(() => vi.fn());
const insertInstrumentTx = vi.hoisted(() => vi.fn());
vi.mock("../src/shared/outbox.js", () => ({ enqueue }));
vi.mock("../src/shared/db.js", () => ({ db: { transaction: async (cb: (tx: unknown) => unknown) => cb({}) } }));
vi.mock("../src/modules/instruments/repo.js", () => ({ findById, transitionTx, insertInstrumentTx }));

import {
  presentInstrument, clearInstrument, bounceInstrument, issueInstrument, assertInstrumentChecker,
} from "../src/modules/instruments/commands.js";

const ISSUER = "issuer-1";
const CHECKER = "checker-2";
const ctxOf = (actorId: string) => ({ tenantId: "t1", actorId, correlationId: "c1" }) as never;
const row = (status: string, createdBy = ISSUER) => ({
  id: "i1", instrumentType: "cheque", instrumentNo: "000123", bankAccountId: null, bankName: "SBI", payee: "A",
  amountMinor: 100n, currency: "INR", issueDate: "2026-09-01", status, presentedAt: null, clearedAt: null,
  bouncedAt: null, cancelledAt: null, bounceReason: null, paymentId: null, version: 1, createdBy,
});

beforeEach(() => { enqueue.mockReset(); findById.mockReset(); transitionTx.mockReset(); insertInstrumentTx.mockReset(); });
afterEach(() => { delete process.env.FINANCE_INSTRUMENT_MAKER_CHECKER; });

describe("audit of every transition", () => {
  it("present audits once with actor and before/after status", async () => {
    findById.mockResolvedValue(row("issued"));
    transitionTx.mockResolvedValue(row("presented"));
    await presentInstrument(ctxOf(ISSUER), "i1");
    expect(enqueue).toHaveBeenCalledTimes(1);
    const evt = enqueue.mock.calls[0][1];
    expect(evt).toMatchObject({ topic: "audit.event.record", actorId: ISSUER });
    expect(evt.payload).toMatchObject({ action: "present", resourceType: "instrument", resourceId: "i1", details: { fromStatus: "issued", toStatus: "presented" } });
  });

  it("clear and bounce audit once each", async () => {
    findById.mockResolvedValue(row("presented"));
    transitionTx.mockResolvedValueOnce(row("cleared"));
    await clearInstrument(ctxOf(CHECKER), "i1");
    transitionTx.mockResolvedValueOnce(row("bounced"));
    await bounceInstrument(ctxOf(CHECKER), "i1", { reason: "Insufficient funds" });
    expect(enqueue.mock.calls.map((c) => c[1].payload.action)).toEqual(["clear", "bounce"]);
  });

  it("an idempotent replay (already in the target state) writes nothing and audits nothing", async () => {
    findById.mockResolvedValue(row("cleared"));
    await clearInstrument(ctxOf(CHECKER), "i1");
    expect(transitionTx).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("a lost race (guard matches no row) is a 409 and audits nothing", async () => {
    findById.mockResolvedValue(row("presented"));
    transitionTx.mockResolvedValue(null);
    await expect(clearInstrument(ctxOf(CHECKER), "i1")).rejects.toMatchObject({ status: 409, code: "ILLEGAL_TRANSITION" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("issue audits only when the instrument was actually created, not on an idempotent re-issue", async () => {
    const body = { instrumentType: "cheque" as const, instrumentNo: "000123", bankName: "SBI", payee: "A", amountMinor: 100, currency: "INR" };
    insertInstrumentTx.mockResolvedValueOnce({ row: row("issued"), created: true });
    await issueInstrument(ctxOf(ISSUER), body);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][1].payload).toMatchObject({ action: "issue", details: { toStatus: "issued" } });
    enqueue.mockReset();
    insertInstrumentTx.mockResolvedValueOnce({ row: row("issued"), created: false });
    await issueInstrument(ctxOf(ISSUER), body);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("maker-checker on clear and bounce", () => {
  it("refuses the issuer clearing or dishonouring their own instrument (403) before any write", async () => {
    findById.mockResolvedValue(row("presented", ISSUER));
    await expect(clearInstrument(ctxOf(ISSUER), "i1")).rejects.toMatchObject({ status: 403, code: "MAKER_CHECKER_VIOLATION" });
    await expect(bounceInstrument(ctxOf(ISSUER), "i1", {})).rejects.toMatchObject({ status: 403, code: "MAKER_CHECKER_VIOLATION" });
    expect(transitionTx).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("allows a different officer, and does not apply to present", async () => {
    findById.mockResolvedValue(row("issued", ISSUER));
    transitionTx.mockResolvedValue(row("presented"));
    await expect(presentInstrument(ctxOf(ISSUER), "i1")).resolves.toBeTruthy();
    transitionTx.mockResolvedValue(row("cleared"));
    await expect(clearInstrument(ctxOf(CHECKER), "i1")).resolves.toBeTruthy();
  });

  it("is always enforced: the former env off-switch no longer has any effect", async () => {
    expect(() => assertInstrumentChecker(ISSUER, ISSUER)).toThrow();
    process.env.FINANCE_INSTRUMENT_MAKER_CHECKER = "off";
    expect(() => assertInstrumentChecker(ISSUER, ISSUER)).toThrow();
    findById.mockResolvedValue(row("presented", ISSUER));
    await expect(clearInstrument(ctxOf(ISSUER), "i1")).rejects.toMatchObject({ status: 403, code: "MAKER_CHECKER_VIOLATION" });
    expect(() => assertInstrumentChecker(ISSUER, CHECKER)).not.toThrow();
  });
});
