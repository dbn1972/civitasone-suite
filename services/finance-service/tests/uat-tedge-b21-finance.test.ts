/**
 * UAT T-EDGE bundle 21 -- finance forms (journal, budget allocation) and the decided-task 409.
 *
 * TE-01 / TE-07: an impossible or implausible posting date is a 400 with a field code (J01-J04),
 * a 1e20 paise line a 400 (J11), an account code with spaces is stored trimmed (J17) and an
 * unknown account code a 422 on that line (J16) -- they used to become drafts that could never
 * post. TE-04 / TE-07: an allocation beyond the sane maximum (BA06), for FY 2031-99 (BA07) or for
 * a head that does not exist (BA09) is refused at the route instead of 202 + dead letter.
 * TE-08: approving a journal that another checker already posted is a 409 TASK_ALREADY_DECIDED
 * naming the decider, not a 202. TE-09: the same X-Idempotency-Key replays the first answer.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeJournals } from "../src/modules/gl/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { istToday } from "@civitasone/schemas/validators";

// Set by the service vitest config (never a literal in a test file: CI scans every commit for secrets).
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const OTHER_CHECKER = randomUUID();
const HEAD = randomUUID();
const CODE = `B21${randomUUID().slice(0, 4)}`;
const today = istToday();
const hdr = (sub: string, roles: string[], key?: string) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s-b21" }, SECRET)}`,
  "content-type": "application/json",
  ...(key ? { "x-idempotency-key": key } : {}),
});
const maker = (key?: string) => hdr(MAKER, ["finance_officer"], key);
const checker = hdr(CHECKER, ["finance_admin"]);

type Body = { code?: string; fieldErrors?: Array<{ field: string; code?: string }>; decidedBy?: { id: string; name: string | null }; data?: { id: string } };
const fieldCode = (b: Body, field: string) => b.fieldErrors?.find((f) => f.field === field)?.code;
const journal = (over: Record<string, unknown> = {}) => ({
  type: "journal", postingDate: today,
  lines: [
    { accountCode: HEAD, debitMinor: "100", creditMinor: "0" },
    { accountCode: HEAD, debitMinor: "0", creditMinor: "100" },
  ],
  ...over,
});

let app: FastifyInstance;
const realFetch = globalThis.fetch;
beforeAll(async () => {
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({ id: HEAD, tenantId: TENANT, code: CODE, name: "B21 head", level: 2, createdBy: MAKER, updatedBy: MAKER }));
  app = await buildApp();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  await app.close();
  await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))).catch(() => {});
  await sqlClient.end();
});

describe("POST /v1/finance/journals -- refused synchronously (TE-01/06/07)", () => {
  it.each([
    ["J01 2027-02-29", "2027-02-29", "DATE_INVALID"],
    ["J02 2026-04-31", "2026-04-31", "DATE_INVALID"],
    ["J03 2099-01-01", "2099-01-01", "DATE_TOO_LATE"],
    ["J04 1990-01-01", "1990-01-01", "DATE_TOO_EARLY"],
  ])("%s -> 400 on postingDate", async (_l, postingDate, code) => {
    const publish = vi.spyOn(queue, "publish");
    const res = await app.inject({ method: "POST", url: "/v1/finance/journals", headers: maker(), payload: journal({ postingDate }) });
    expect(res.statusCode).toBe(400);
    expect(fieldCode(res.json(), "postingDate")).toBe(code);
    expect(publish).not.toHaveBeenCalled();
  });
  it("J11 1e20 paise -> 400 AMOUNT_TOO_LARGE", async () => {
    const big = "100000000000000000000";
    const res = await app.inject({ method: "POST", url: "/v1/finance/journals", headers: maker(), payload: journal({ lines: [
      { accountCode: HEAD, debitMinor: big, creditMinor: "0" }, { accountCode: HEAD, debitMinor: "0", creditMinor: big },
    ] }) });
    expect(res.statusCode).toBe(400);
    expect(fieldCode(res.json(), "lines.0.debitMinor")).toBe("AMOUNT_TOO_LARGE");
  });
  it("J16 an account code that is not in the chart -> 422 UNKNOWN_ACCOUNT_CODE on that line", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/finance/journals", headers: maker(), payload: journal({ lines: [
      { accountCode: CODE, debitMinor: "100", creditMinor: "0" }, { accountCode: "NO-SUCH-9", debitMinor: "0", creditMinor: "100" },
    ] }) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("UNKNOWN_ACCOUNT_CODE");
    expect(fieldCode(res.json(), "lines.1.accountCode")).toBe("UNKNOWN_ACCOUNT_CODE");
    expect(fieldCode(res.json(), "lines.0.accountCode")).toBeUndefined();
  });
  it("J17 an account code with spaces is trimmed and accepted; the same key replays the same 202", async () => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const key = `b21-${randomUUID()}`;
    const body = journal({ lines: [
      { accountCode: `  ${CODE}  `, debitMinor: "100", creditMinor: "0" }, { accountCode: CODE, debitMinor: "0", creditMinor: "100" },
    ] });
    const a = await app.inject({ method: "POST", url: "/v1/finance/journals", headers: maker(key), payload: body });
    const b = await app.inject({ method: "POST", url: "/v1/finance/journals", headers: maker(key), payload: body });
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    expect(b.json().id).toBe(a.json().id);
    expect(publish).toHaveBeenCalledTimes(1);
    const lines = (publish.mock.calls[0]![1] as { payload: { lines: Array<{ accountCode: string }> } }).payload.lines;
    expect(lines[0]!.accountCode).toBe(CODE);
    const c = await app.inject({ method: "POST", url: "/v1/finance/journals", headers: maker(key), payload: journal() });
    expect(c.statusCode).toBe(422);
    expect(c.json().code).toBe("IDEMPOTENCY_KEY_REUSED");
  });
});

describe("POST /v1/finance/budget-allocations (TE-04/07)", () => {
  it("BA06 1e20 paise -> 400 AMOUNT_TOO_LARGE", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/finance/budget-allocations", headers: maker(), payload: { headId: HEAD, fy: "2026-27", allocatedMinor: "100000000000000000000" } });
    expect(res.statusCode).toBe(400);
    expect(fieldCode(res.json(), "allocatedMinor")).toBe("AMOUNT_TOO_LARGE");
  });
  it.each(["2031-99", "2026-26"])("BA07 FY %s -> 400 FY_INVALID", async (fy) => {
    const res = await app.inject({ method: "POST", url: "/v1/finance/budget-allocations", headers: maker(), payload: { headId: HEAD, fy, allocatedMinor: 100 } });
    expect(res.statusCode).toBe(400);
    expect(fieldCode(res.json(), "fy")).toBe("FY_INVALID");
  });
  it("BA09 a head that does not exist -> 422 HEAD_NOT_FOUND, nothing queued", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await app.inject({ method: "POST", url: "/v1/finance/budget-allocations", headers: maker(), payload: { headId: randomUUID(), fy: "2026-27", allocatedMinor: 100 } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("HEAD_NOT_FOUND");
    expect(fieldCode(res.json(), "headId")).toBe("HEAD_NOT_FOUND");
    expect(publish).not.toHaveBeenCalled();
  });
  it("a valid allocation is accepted once per idempotency key", async () => {
    const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    const key = `b21-${randomUUID()}`;
    const body = { headId: HEAD, fy: "2026-27", allocatedMinor: 100000 };
    const a = await app.inject({ method: "POST", url: "/v1/finance/budget-allocations", headers: maker(key), payload: body });
    const b = await app.inject({ method: "POST", url: "/v1/finance/budget-allocations", headers: maker(key), payload: body });
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    expect(b.json().data.id).toBe(a.json().data.id);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe("POST /v1/finance/bills (TE-11 / TE-04 / B06-B09)", () => {
  const bill = (over: Record<string, unknown> = {}) => ({ billNo: `B21-${randomUUID().slice(0, 6)}`, vendorId: randomUUID(), headId: HEAD, ddoCode: "DDO123", grossMinor: "100000", ...over });
  it.each([
    ["B07 bill date 2026-02-29", { billDate: "2026-02-29" }, "billDate", "DATE_INVALID"],
    ["B08 bill date 2099-01-01", { billDate: "2099-01-01" }, "billDate", "DATE_TOO_LATE"],
    ["B09 bill no of spaces", { billNo: "    " }, "billNo", "TEXT_BLANK"],
    ["B06 gross 1e20 paise", { grossMinor: "100000000000000000000" }, "grossMinor", "AMOUNT_TOO_LARGE"],
  ])("%s -> 400", async (_l, over, field, code) => {
    const res = await app.inject({ method: "POST", url: "/v1/finance/bills", headers: maker(), payload: bill(over) });
    expect(res.statusCode).toBe(400);
    expect(fieldCode(res.json(), field)).toBe(code);
  });
  it("a head with no head-of-account code -> 422 HOA_EMPTY on headId, not 202 + finance.bill.rejected", async () => {
    const publish = vi.spyOn(queue, "publish");
    const res = await app.inject({ method: "POST", url: "/v1/finance/bills", headers: maker(), payload: bill() });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("HOA_EMPTY");
    expect(fieldCode(res.json(), "headId")).toBe("HOA_EMPTY");
    expect(publish).not.toHaveBeenCalled();
  });
  it("a head that does not exist -> 422 HEAD_NOT_FOUND", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/finance/bills", headers: maker(), payload: bill({ headId: randomUUID() }) });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("HEAD_NOT_FOUND");
  });
});

describe("PATCH /v1/finance/journals/:id/approve on an already-posted journal (TE-08)", () => {
  it("-> 409 TASK_ALREADY_DECIDED with the decider name, nothing queued", async () => {
    const id = randomUUID();
    await scoped(TENANT, (tx) => tx.insert(financeJournals).values({
      id, tenantId: TENANT, voucherNo: `JOURNAL/B21/${id.slice(0, 6)}`, type: "journal", postingDate: today,
      lines: [], status: "posted", createdBy: MAKER, updatedBy: OTHER_CHECKER,
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/identity/internal/user-summaries")) return realFetch(input, init);
      return new Response(JSON.stringify([{ id: OTHER_CHECKER, name: "Asha Rao" }]), { status: 200, headers: { "content-type": "application/json" } });
    });
    const publish = vi.spyOn(queue, "publish");
    const res = await app.inject({ method: "PATCH", url: `/v1/finance/journals/${id}/approve`, headers: checker, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("TASK_ALREADY_DECIDED");
    expect(res.json().decidedBy).toEqual({ id: OTHER_CHECKER, name: "Asha Rao" });
    expect(publish).not.toHaveBeenCalled();
  });
});

