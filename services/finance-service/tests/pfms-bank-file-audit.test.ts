/**
 * GAP-FINANCE-PFMS-03: GET /v1/finance/pfms/:id/bank-file must require a stated
 * reason and write an audit event (actor, batch, reason) before releasing the
 * file. Pure route-level test: repo, db and the outbox are mocked, so no
 * Postgres is needed; the HS256 test-token path of resolveServiceContext
 * supplies the actor/tenant/roles.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { signToken } from "@civitasone/auth";

const enqueueMock = vi.fn();
const txStub = { __tx: true };
const txFn = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txStub));
const findPfmsById = vi.fn();
const listRealBeneficiaries = vi.fn();

vi.mock("../src/shared/db.js", () => ({ db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => txFn(fn) } }));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: (...a: unknown[]) => enqueueMock(...a) }));
vi.mock("../src/modules/pfms/repo.js", () => ({
  findPfmsById: (...a: unknown[]) => findPfmsById(...a),
  listRealBeneficiaries: (...a: unknown[]) => listRealBeneficiaries(...a),
}));

import { pfmsRoutes } from "../src/modules/pfms/routes.js";
import { financeErrorHandler } from "../src/shared/context.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-0000000000a1";
const ACTOR = "00000000-aaaa-4000-8000-0000000000a1";
const BATCH = "66666666-ffff-4000-8000-0000000000a1";

async function app() {
  const a = Fastify();
  a.setErrorHandler(financeErrorHandler);
  await a.register(pfmsRoutes);
  await a.ready();
  return a;
}

function token(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, actorType: "user" } as never, SECRET);
}

describe("GET /v1/finance/pfms/:id/bank-file audit (GAP-FINANCE-PFMS-03)", () => {
  beforeEach(() => {
    enqueueMock.mockReset();
    txFn.mockClear();
    findPfmsById.mockReset().mockResolvedValue({
      id: BATCH, pfmsId: "PFMS-1", channel: "treasury_batch", submissionStatus: "pending", agencyCode: "AG", schemeCode: "SC", ddoCode: "DDO1",
    });
    listRealBeneficiaries.mockReset().mockResolvedValue([
      { beneficiary: "Acme", account: "123456789012", ifsc: "HDFC0001234", amountMinor: 150000n, ref: "R1", ddoCode: "DDO1" },
    ]);
  });

  it("rejects a download with no reason (400) and releases nothing", async () => {
    const a = await app();
    const res = await a.inject({ method: "GET", url: `/v1/finance/pfms/${BATCH}/bank-file`, headers: { authorization: `Bearer ${token(["finance_officer"])}` } });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain("123456789012");
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("rejects a too-short reason", async () => {
    const a = await app();
    const res = await a.inject({ method: "GET", url: `/v1/finance/pfms/${BATCH}/bank-file?reason=ab`, headers: { authorization: `Bearer ${token(["finance_officer"])}` } });
    expect(res.statusCode).toBe(400);
  });

  it("writes exactly one audit event with actor, batch and reason, then releases the file", async () => {
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: `/v1/finance/pfms/${BATCH}/bank-file?reason=${encodeURIComponent("Upload to SBI SFTP, Sep payroll")}`,
      headers: { authorization: `Bearer ${token(["finance_officer"])}`, "user-agent": "vitest" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("123456789012");
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const [tx, evt] = enqueueMock.mock.calls[0] as [unknown, Record<string, any>];
    expect(tx).toBe(txStub);
    expect(evt).toMatchObject({ topic: "audit.event.record", tenantId: TENANT, actorId: ACTOR });
    expect(evt.payload).toMatchObject({
      action: "export", resourceType: "pfms_bank_file", resourceId: BATCH, outcome: "success",
      reason: "Upload to SBI SFTP, Sep payroll", beneficiaryCount: 1, userAgent: "vitest",
    });
    // the audit payload must never carry the account numbers themselves
    expect(JSON.stringify(evt.payload)).not.toContain("123456789012");
  });

  it("does not release the file when the audit write fails", async () => {
    enqueueMock.mockRejectedValue(new Error("outbox down"));
    const a = await app();
    const res = await a.inject({ method: "GET", url: `/v1/finance/pfms/${BATCH}/bank-file?reason=testing+audit`, headers: { authorization: `Bearer ${token(["finance_admin"])}` } });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.body).not.toContain("123456789012");
  });

  it("still 403s a role outside FINANCE_ROLES (audit_officer) and writes no audit event", async () => {
    const a = await app();
    const res = await a.inject({ method: "GET", url: `/v1/finance/pfms/${BATCH}/bank-file?reason=testing+audit`, headers: { authorization: `Bearer ${token(["audit_officer"])}` } });
    expect(res.statusCode).toBe(403);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("truncates an oversized user-agent to 512 chars (audit column is varchar(512))", async () => {
    const a = await app();
    const res = await a.inject({
      method: "GET",
      url: `/v1/finance/pfms/${BATCH}/bank-file?reason=testing+audit`,
      headers: { authorization: `Bearer ${token(["finance_officer"])}`, "user-agent": "x".repeat(2000) },
    });
    expect(res.statusCode).toBe(200);
    const [, evt] = enqueueMock.mock.calls[0] as [unknown, Record<string, any>];
    expect(evt.payload.userAgent).toHaveLength(512);
  });
});
