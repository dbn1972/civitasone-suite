/**
 * UAT bundle 8 F63: the approve route fails fast on self-approval (403 MAKER_CHECKER_VIOLATION)
 * instead of answering 202 for a command the consumer will dead-letter.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const TENANT = "b8f63000-0000-4000-8000-0000000000aa";
const MAKER = "b8f63000-0000-4000-8000-0000000000a1";
const CHECKER = "b8f63000-0000-4000-8000-0000000000b2";
const REPORT = "b8f63000-0000-4000-8000-0000000000c3";
const SECRET = process.env.JWT_SECRET ?? ""; // set by vitest.config.ts env

const H = vi.hoisted(() => ({ find: vi.fn(), approve: vi.fn() }));
vi.mock("../src/modules/reports/repo.js", () => ({
  listReports: vi.fn(async () => []),
  findReportById: (...a: unknown[]) => H.find(...a),
  listObservations: vi.fn(async () => []),
}));
vi.mock("../src/modules/reports/commands.js", () => ({
  createReport: vi.fn(), addObservation: vi.fn(), submitReport: vi.fn(),
  approveReport: (...a: unknown[]) => H.approve(...a),
}));

const auth = (sub: string) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles: ["reviewing_officer"], sid: "s" }, SECRET, 3600)}`,
});

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});
afterAll(async () => { await app?.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  H.find.mockResolvedValue({
    id: REPORT, tenantId: TENANT, status: "submitted", inspectorId: MAKER, createdBy: MAKER, updatedBy: MAKER,
  });
  H.approve.mockResolvedValue({ id: REPORT, status: "accepted", correlationId: "c" });
});

describe("POST /v1/inspection/reports/:id/approve maker-checker", () => {
  it("403s self-approval and publishes nothing", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/inspection/reports/${REPORT}/approve`, headers: auth(MAKER) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code ?? res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect(H.approve).not.toHaveBeenCalled();
  });

  it("202s a distinct approver", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/inspection/reports/${REPORT}/approve`, headers: auth(CHECKER) });
    expect(res.statusCode).toBe(202);
    expect(H.approve).toHaveBeenCalledTimes(1);
  });

  it("404s a report that does not exist in the tenant", async () => {
    H.find.mockResolvedValue(undefined);
    const res = await app.inject({ method: "POST", url: `/v1/inspection/reports/${REPORT}/approve`, headers: auth(CHECKER) });
    expect(res.statusCode).toBe(404);
    expect(H.approve).not.toHaveBeenCalled();
  });
});
