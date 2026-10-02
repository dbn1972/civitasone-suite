/**
 * GAP-FINANCE-RECONCILIATION-01: resolve / write_off need a trimmed note of
 * 10-1000 chars (server-side); the audit event carries the sub-action, new
 * status and note; investigate/reopen never wipe a stored resolutionNote.
 * Mocked: no Postgres.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { signToken } from "@civitasone/auth";

const getBreak = vi.fn();
const applyCmd = vi.fn();
vi.mock("../src/modules/recon/repo.js", () => ({
  getBreak: (...a: unknown[]) => getBreak(...a),
  getBreakTx: vi.fn(),
  updateBreakStatus: vi.fn(),
}));
vi.mock("../src/modules/recon/commands.js", () => ({
  applyExceptionActionCmd: (...a: unknown[]) => applyCmd(...a),
  startReconRun: vi.fn(),
}));

import { reconRoutes, actionBody } from "../src/modules/recon/routes.js";
import { financeErrorHandler } from "../src/shared/context.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-0000000000a1";
const ACTOR = "00000000-aaaa-4000-8000-0000000000a1";
const BREAK = "66666666-ffff-4000-8000-0000000000a1";

async function post(body: unknown) {
  const a = Fastify();
  a.setErrorHandler(financeErrorHandler);
  await a.register(reconRoutes);
  await a.ready();
  const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["finance_officer"], actorType: "user" } as never, SECRET);
  return a.inject({
    method: "POST",
    url: `/v1/finance/recon/exceptions/${BREAK}/action`,
    headers: { authorization: `Bearer ${token}` },
    payload: body as object,
  });
}

describe("recon action body (server validation)", () => {
  beforeEach(() => {
    getBreak.mockReset().mockResolvedValue({ id: BREAK, status: "open" });
    applyCmd.mockReset().mockResolvedValue({ id: BREAK, status: "accepted", correlationId: "c1" });
  });

  it.each(["resolve", "write_off"])("%s without a note is 400 and nothing is enqueued", async (action) => {
    const res = await post({ action });
    expect(res.statusCode).toBe(400);
    expect(applyCmd).not.toHaveBeenCalled();
  });

  it("a whitespace-padded short note does not satisfy the minimum", async () => {
    const res = await post({ action: "write_off", note: "   short     " });
    expect(res.statusCode).toBe(400);
    expect(applyCmd).not.toHaveBeenCalled();
  });

  it("rejects a note over 1000 chars", () => {
    expect(actionBody.safeParse({ action: "resolve", note: "x".repeat(1001) }).success).toBe(false);
    expect(actionBody.safeParse({ action: "resolve", note: "x".repeat(1000) }).success).toBe(true);
  });

  it("accepts a valid note and passes the TRIMMED note to the command", async () => {
    const res = await post({ action: "write_off", note: "  Bank charge approved by CFO memo 12  " });
    expect(res.statusCode).toBe(202);
    expect(applyCmd).toHaveBeenCalledTimes(1);
    expect(applyCmd.mock.calls[0]![2]).toMatchObject({ action: "write_off", note: "Bank charge approved by CFO memo 12" });
  });

  it("investigate and reopen need no note", async () => {
    expect((await post({ action: "investigate" })).statusCode).toBe(202);
    getBreak.mockResolvedValue({ id: BREAK, status: "resolved" });
    expect((await post({ action: "reopen" })).statusCode).toBe(202);
  });
});
