/**
 * GPF (General Provident Fund) route-level tests.
 * Covers: happy path, 400, 401, 403, 404, 409 for all GPF endpoints.
 *
 * `subscription` / `advance` / `withdrawal` / `refund` / `interest` publish
 * via `publishF3Write`, which is fire-and-forget: the actual ledger write
 * (balance lock + INSUFFICIENT_BALANCE guard + insert) happens later, in the
 * `gpf_routes__1` / `gpf_routes__2` consumer, inside its own transaction. The
 * mocked `queue.publish` here is a no-op stub (see the `../src/shared/infra.js`
 * mock below), so it never invokes that consumer — these route-level tests can
 * therefore only assert what the ROUTE itself decides synchronously (status
 * code, entryType, amount, ratePct/months) and CANNOT observe the resulting
 * balance or the INSUFFICIENT_BALANCE guard. That coverage lives in
 * `src/modules/gpf/f3-consumer.test.ts`, against the consumer directly.
 *
 * (This replaces route-level assertions that used to expect a synchronous
 * `balanceMinor`/`interestMinor` in the response and a 409 on an
 * over-large debit — those never actually happened: the route used to
 * destructure `{ prev, next }` off `publishF3Write`'s return value, which
 * only ever resolves `{ id, status, correlationId }`, so `balanceMinor` was
 * always `undefined` and the balance guard was never evaluated
 * synchronously. See routes.ts and f3-consumer.ts for the fix.)
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP = "bbbbbbbb-0001-4000-8000-000000000001";
const ACCT = "cccccccc-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  // repo mocks
  findAccountByEmployee: vi.fn(),
  insertAccount: vi.fn(),
  insertLedger: vi.fn(),
  currentBalance: vi.fn(),
  lockedBalance: vi.fn(),
  listLedger: vi.fn(),
  bumpAccountVersion: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        return {
          limit: (n: unknown) => H.selectFrom(...args, ...w),
          orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args, ...w) }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(result).then(resolve, reject),
        };
      },
      orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args) }),
    }),
  });
  const mockTx = {
    select: (...args: unknown[]) => createSelectChain(...args),
    update: (t: unknown) => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }) }),
    insert: (t: unknown) => ({ values: (v: unknown) => H.insert(v) }),
    execute: (q: unknown) => H.execute(q),
  };
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
    sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":"), getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn() },
  queue: { publish: async () => {} },
}));

vi.mock("../src/modules/gpf/repo.js", () => ({
  findAccountByEmployee: (...a: unknown[]) => H.findAccountByEmployee(...a),
  insertAccount: (...a: unknown[]) => H.insertAccount(...a),
  insertLedger: (...a: unknown[]) => H.insertLedger(...a),
  currentBalance: (...a: unknown[]) => H.currentBalance(...a),
  lockedBalance: (...a: unknown[]) => H.lockedBalance(...a),
  listLedger: (...a: unknown[]) => H.listLedger(...a),
  bumpAccountVersion: (...a: unknown[]) => H.bumpAccountVersion(...a),
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(sub, roles)}` });

const employee = (over = {}) => ({
  id: EMP, tenantId: TENANT, employeeNo: "E-001", fullName: "Test Emp",
  departmentId: "dddddddd-0001-4000-8000-000000000001",
  pensionScheme: "GPF", status: "confirmed",
  ...over,
});

const gpfAccount = (over = {}): Record<string, unknown> => ({
  id: ACCT, tenantId: TENANT, employeeId: EMP, gpfNumber: "GPF-1001",
  openingBalanceMinor: 100000n, monthlySubscriptionMinor: 5000n,
  interestRatePct: "7.10", version: 1,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.selectFrom.mockResolvedValue([employee()]);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue({ rowCount: 1 });
  H.execute.mockResolvedValue(undefined);
  H.findAccountByEmployee.mockResolvedValue(null);
  H.insertAccount.mockResolvedValue(undefined);
  H.insertLedger.mockResolvedValue(undefined);
  H.currentBalance.mockResolvedValue(100000n);
  H.lockedBalance.mockResolvedValue(100000n);
  H.listLedger.mockResolvedValue([]);
  H.bumpAccountVersion.mockResolvedValue(undefined);
});
afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

describe("GPF — open account", () => {
  describe("POST /v1/hrms/employees/:id/gpf", () => {
    const payload = { gpfNumber: "GPF-1001", openingBalanceMinor: 100000, monthlySubscriptionMinor: 5000, interestRatePct: 7.1 };

    it("opens a GPF account (201)", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf`, headers: auth(), payload });
      expect(r.statusCode).toBe(201);
      expect(r.json().gpfNumber).toBe("GPF-1001");
      expect(r.json().employeeId).toBe(EMP);
      await app.close();
    });

    it("returns 400 on invalid payload", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf`, headers: auth(), payload: { gpfNumber: "" } });
      expect(r.statusCode).toBe(400);
      expect(r.json().code).toBe("VALIDATION_FAILED");
      await app.close();
    });

    it("returns 400 on invalid UUID param", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/not-uuid/gpf`, headers: auth(), payload });
      expect(r.statusCode).toBe(400);
      await app.close();
    });

    it("returns 401 without token", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf`, payload });
      expect(r.statusCode).toBe(401);
      await app.close();
    });

    it("returns 403 for unauthorized role", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf`, headers: auth(USER, ["employee"]), payload });
      expect(r.statusCode).toBe(403);
      await app.close();
    });

    it("returns 404 when employee not found", async () => {
      H.selectFrom.mockResolvedValue([]);
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf`, headers: auth(), payload });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe("NOT_FOUND");
      await app.close();
    });

    it("returns 409 when employee is not on GPF scheme", async () => {
      H.selectFrom.mockResolvedValue([employee({ pensionScheme: "NPS" })]);
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf`, headers: auth(), payload });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("NOT_GPF_SCHEME");
      await app.close();
    });

    it("returns 409 when GPF account already exists", async () => {
      H.findAccountByEmployee.mockResolvedValue(gpfAccount());
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf`, headers: auth(), payload });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe("GPF_EXISTS");
      await app.close();
    });
  });
});

describe("GPF — read account + ledger", () => {
  describe("GET /v1/hrms/employees/:id/gpf", () => {
    it("returns account, balance and ledger (200)", async () => {
      H.findAccountByEmployee.mockResolvedValue(gpfAccount());
      H.currentBalance.mockResolvedValue(150000n);
      H.listLedger.mockResolvedValue([{ id: "l1", entryType: "opening", amountMinor: 100000n, balanceMinor: 100000n }]);
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/gpf`, headers: auth() });
      expect(r.statusCode).toBe(200);
      expect(r.json().runningBalanceMinor).toBe("150000");
      expect(r.json().ledger).toHaveLength(1);
      await app.close();
    });

    it("returns 401 without token", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/gpf` });
      expect(r.statusCode).toBe(401);
      await app.close();
    });

    it("returns 404 when no GPF account", async () => {
      H.findAccountByEmployee.mockResolvedValue(null);
      const app = await buildApp();
      const r = await app.inject({ method: "GET", url: `/v1/hrms/employees/${EMP}/gpf`, headers: auth() });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe("NO_GPF_ACCOUNT");
      await app.close();
    });
  });
});

describe("GPF — subscription (credit)", () => {
  describe("POST /v1/hrms/employees/:id/gpf/subscription", () => {
    it("accepts a subscription credit for async posting (202)", async () => {
      H.findAccountByEmployee.mockResolvedValue(gpfAccount());
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf/subscription`, headers: auth(), payload: { amountMinor: 5000 } });
      // 202, not 201: the ledger row does not exist yet — it is written later
      // by the consumer. See the INSUFFICIENT_BALANCE / correct-sign coverage
      // in f3-consumer.test.ts for what actually lands.
      expect(r.statusCode).toBe(202);
      expect(r.json().entryType).toBe("subscription");
      expect(r.json().amountMinor).toBe("5000");
      expect(r.json().status).toBe("accepted");
      expect(r.json().ledgerId).toBeTruthy();
      // publishF3Write only ever resolves { id, status, correlationId } — the
      // route must not claim to know the resulting balance synchronously.
      expect(r.json().balanceMinor).toBeUndefined();
      expect(r.json().previousBalanceMinor).toBeUndefined();
      await app.close();
    });

    it("returns 400 on missing amountMinor", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf/subscription`, headers: auth(), payload: {} });
      expect(r.statusCode).toBe(400);
      await app.close();
    });

    it("returns 404 when no GPF account", async () => {
      H.findAccountByEmployee.mockResolvedValue(null);
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf/subscription`, headers: auth(), payload: { amountMinor: 5000 } });
      expect(r.statusCode).toBe(404);
      await app.close();
    });
  });
});

describe("GPF — advance (debit)", () => {
  describe("POST /v1/hrms/employees/:id/gpf/advance", () => {
    it("accepts an advance debit for async posting (202)", async () => {
      H.findAccountByEmployee.mockResolvedValue(gpfAccount());
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf/advance`, headers: auth(), payload: { amountMinor: 50000 } });
      expect(r.statusCode).toBe(202);
      expect(r.json().entryType).toBe("advance");
      expect(r.json().amountMinor).toBe("50000");
      expect(r.json().balanceMinor).toBeUndefined();
      await app.close();
    });

    // The INSUFFICIENT_BALANCE guard runs inside the consumer's locked
    // transaction (C1), not synchronously in this route — two concurrent
    // debits against the same account must serialise on the SAME lock to be
    // guarded correctly, which a synchronous pre-check here could not do
    // (see routes.ts). That guard is exercised directly against the consumer
    // in f3-consumer.test.ts ("rejects a debit that would drive the balance
    // negative"); this route always answers 202 regardless of balance.
    it("still answers 202 for an oversized debit — the balance guard is async (see f3-consumer.test.ts)", async () => {
      H.findAccountByEmployee.mockResolvedValue(gpfAccount());
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf/advance`, headers: auth(), payload: { amountMinor: 99999 } });
      expect(r.statusCode).toBe(202);
      await app.close();
    });
  });
});

describe("GPF — refund (credit)", () => {
  describe("POST /v1/hrms/employees/:id/gpf/refund", () => {
    it("accepts a refund credit for async posting (202)", async () => {
      H.findAccountByEmployee.mockResolvedValue(gpfAccount());
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf/refund`, headers: auth(), payload: { amountMinor: 20000 } });
      expect(r.statusCode).toBe(202);
      expect(r.json().entryType).toBe("refund");
      expect(r.json().amountMinor).toBe("20000");
      await app.close();
    });
  });
});

describe("GPF — interest accrual", () => {
  describe("POST /v1/hrms/employees/:id/gpf/interest", () => {
    it("accepts interest accrual for async posting (202)", async () => {
      H.findAccountByEmployee.mockResolvedValue(gpfAccount());
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf/interest`, headers: auth(), payload: { months: 12 } });
      expect(r.statusCode).toBe(202);
      expect(r.json().months).toBe(12);
      expect(r.json().ratePct).toBe(7.1);
      expect(r.json().status).toBe("accepted");
      // interestMinor/balanceMinor depend on the locked, serialised balance
      // the consumer reads at write time (C1) — not known here. See
      // f3-consumer.test.ts for the actual accrual math.
      expect(r.json().interestMinor).toBeUndefined();
      expect(r.json().balanceMinor).toBeUndefined();
      await app.close();
    });

    it("uses ratePctOverride when provided (202)", async () => {
      H.findAccountByEmployee.mockResolvedValue(gpfAccount());
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf/interest`, headers: auth(), payload: { months: 6, ratePctOverride: 10 } });
      expect(r.statusCode).toBe(202);
      expect(r.json().ratePct).toBe(10);
      await app.close();
    });

    it("returns 403 for unauthorized role", async () => {
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf/interest`, headers: auth(USER, ["employee"]), payload: { months: 12 } });
      expect(r.statusCode).toBe(403);
      await app.close();
    });

    it("returns 404 when no GPF account", async () => {
      H.findAccountByEmployee.mockResolvedValue(null);
      const app = await buildApp();
      const r = await app.inject({ method: "POST", url: `/v1/hrms/employees/${EMP}/gpf/interest`, headers: auth(), payload: { months: 12 } });
      expect(r.statusCode).toBe(404);
      await app.close();
    });
  });
});
