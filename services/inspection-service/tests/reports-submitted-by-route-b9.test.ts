/**
 * UAT bundle 9 (B9-insp): the approve route must compare the approver with the recorded submitter
 * (submitted_by), not with updated_by, and answer a sync 403 for self-approval.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const TENANT = "b9a00000-0000-4000-8000-0000000000aa";
const INSPECTOR = "b9a00000-0000-4000-8000-0000000000a1";
const SUBMITTER = "b9a00000-0000-4000-8000-0000000000a2";
const OTHER = "b9a00000-0000-4000-8000-0000000000a3";
const REPORT = "b9a00000-0000-4000-8000-0000000000c3";
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
const approve = (sub: string) =>
  app.inject({ method: "POST", url: `/v1/inspection/reports/${REPORT}/approve`, headers: auth(sub) });

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
    id: REPORT, tenantId: TENANT, status: "submitted",
    inspectorId: INSPECTOR, createdBy: INSPECTOR, submittedBy: SUBMITTER, updatedBy: OTHER,
  });
  H.approve.mockResolvedValue({ id: REPORT, status: "accepted", correlationId: "c" });
});

describe("POST /v1/inspection/reports/:id/approve uses submitted_by", () => {
  it("403s the recorded submitter even when updated_by is someone else", async () => {
    const res = await approve(SUBMITTER);
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code ?? res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect(H.approve).not.toHaveBeenCalled();
  });

  it("202s an approver who only last touched the row (not a maker)", async () => {
    const res = await approve(OTHER);
    expect(res.statusCode).toBe(202);
    expect(H.approve).toHaveBeenCalledTimes(1);
  });

  it("falls back to updated_by for a legacy row with no submitted_by", async () => {
    H.find.mockResolvedValue({
      id: REPORT, tenantId: TENANT, status: "submitted",
      inspectorId: INSPECTOR, createdBy: INSPECTOR, submittedBy: null, updatedBy: SUBMITTER,
    });
    const res = await approve(SUBMITTER);
    expect(res.statusCode).toBe(403);
    expect(H.approve).not.toHaveBeenCalled();
  });
});
