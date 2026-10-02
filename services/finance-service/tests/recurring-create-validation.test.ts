/**
 * GAP-FINANCE-RECURRING-ENTRIES-04/-06: the create route takes only voucher
 * types the cashbook CHECK allows and rejects a back-dated first run.
 * Mocked: no Postgres, no queue.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { signToken } from "@civitasone/auth";

const publish = vi.fn();
vi.mock("../src/shared/infra.js", () => ({ queue: { publish: (...a: unknown[]) => publish(...a) } }));
vi.mock("../src/shared/db.js", () => ({ scopedRead: vi.fn() }));

import { recurringRoutes, RECURRING_VOUCHER_TYPES, todayIstDate } from "../src/modules/recurring/routes.js";
import { financeErrorHandler } from "../src/shared/context.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-0000000000a1";
const ACTOR = "00000000-aaaa-4000-8000-0000000000a1";
const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";

const BODY = { name: "Rent", debitAccountId: A1, creditAccountId: A2, amountMinor: 12000000, nextRunDate: "2099-01-01" };

async function post(body: unknown) {
  const a = Fastify();
  a.setErrorHandler(financeErrorHandler);
  await a.register(recurringRoutes);
  await a.ready();
  const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["finance_officer"], actorType: "user" } as never, SECRET);
  return a.inject({ method: "POST", url: "/v1/finance/recurring-entries", headers: { authorization: `Bearer ${token}` }, payload: body as object });
}

describe("POST /v1/finance/recurring-entries validation", () => {
  beforeEach(() => {
    publish.mockReset().mockResolvedValue(undefined);
  });

  it("accepts a valid template (voucherType defaults to journal)", async () => {
    const res = await post(BODY);
    expect(res.statusCode).toBe(202);
    expect(publish.mock.calls[0]![1].payload.voucherType).toBe("journal");
  });

  it("voucher types are exactly the cashbook CHECK set (no 'transfer')", () => {
    expect([...RECURRING_VOUCHER_TYPES].sort()).toEqual(["contra", "credit_note", "debit_note", "journal", "payment", "receipt"]);
  });

  it.each(["transfer", "jornal", "x".repeat(21)])("rejects voucherType %s", async (voucherType) => {
    expect((await post({ ...BODY, voucherType })).statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a back-dated nextRunDate, accepts today (IST)", async () => {
    expect((await post({ ...BODY, nextRunDate: "2020-01-01" })).statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
    expect((await post({ ...BODY, nextRunDate: todayIstDate() })).statusCode).toBe(202);
  });

  it("rejects an endDate before nextRunDate", async () => {
    expect((await post({ ...BODY, endDate: "2098-12-31" })).statusCode).toBe(400);
  });

  it("todayIstDate rolls over at 18:30 UTC", () => {
    expect(todayIstDate(Date.UTC(2026, 9, 3, 18, 29))).toBe("2026-10-03");
    expect(todayIstDate(Date.UTC(2026, 9, 3, 18, 31))).toBe("2026-10-04");
  });
});
