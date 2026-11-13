/**
 * Gap-fix wave (HANDOFF 5 item 7): inspection reports can be rejected.
 * Route level: role gate (approving officer only), mandatory reason, maker-checker (inspector, author
 * and submitter cannot reject their own report), state guard, resubmission of a rejected report.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const TENANT = "9a7f0000-0000-4000-8000-0000000000aa";
const INSPECTOR = "9a7f0000-0000-4000-8000-0000000000a1";
const AUTHOR = "9a7f0000-0000-4000-8000-0000000000a2";
const SUBMITTER = "9a7f0000-0000-4000-8000-0000000000a3";
const OFFICER = "9a7f0000-0000-4000-8000-0000000000b2";
const REPORT = "9a7f0000-0000-4000-8000-0000000000c3";
const SECRET = process.env.JWT_SECRET ?? "";

const H = vi.hoisted(() => ({ find: vi.fn(), reject: vi.fn(), submit: vi.fn(), observe: vi.fn(), approve: vi.fn() }));
vi.mock("../src/modules/reports/repo.js", () => ({
  listReports: vi.fn(async () => []),
  findReportById: (...a: unknown[]) => H.find(...a),
  listObservations: vi.fn(async () => []),
}));
vi.mock("../src/modules/reports/commands.js", () => ({
  createReport: vi.fn(),
  addObservation: (...a: unknown[]) => H.observe(...a),
  submitReport: (...a: unknown[]) => H.submit(...a),
  approveReport: (...a: unknown[]) => H.approve(...a),
  rejectReport: (...a: unknown[]) => H.reject(...a),
}));

const as = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET, 3600)}`,
});
const reject = (headers: Record<string, string>, payload?: unknown) =>
  app.inject({ method: "POST", url: `/v1/inspection/reports/${REPORT}/reject`, headers, ...(payload === undefined ? {} : { payload }) });

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
    id: REPORT, tenantId: TENANT, status: "submitted", inspectorId: INSPECTOR, createdBy: AUTHOR, updatedBy: SUBMITTER, submittedBy: SUBMITTER,
  });
  for (const f of [H.reject, H.submit, H.observe, H.approve]) f.mockResolvedValue({ id: REPORT, status: "accepted", correlationId: "c" });
});

describe("POST /v1/inspection/reports/:id/reject", () => {
  it("202s a distinct reviewing officer and publishes the trimmed reason", async () => {
    const res = await reject(as(OFFICER, ["reviewing_officer"]), { reason: "  Summary does not match the observations  " });
    expect(res.statusCode).toBe(202);
    expect(H.reject).toHaveBeenCalledTimes(1);
    expect(H.reject.mock.calls[0]![1]).toBe(REPORT);
    expect(H.reject.mock.calls[0]![2]).toBe("Summary does not match the observations");
  });

  it("is refused for an inspector, a supervising officer and a role-less caller (approving officer only)", async () => {
    for (const roles of [["inspector"], ["supervising_officer"], ["citizen"]]) {
      const res = await reject(as(OFFICER, roles), { reason: "not good enough" });
      expect(res.statusCode).toBe(403);
    }
    expect(H.reject).not.toHaveBeenCalled();
  });

  it("requires a reason: missing, blank and too-short reasons are 400 and publish nothing", async () => {
    for (const payload of [undefined, {}, { reason: "" }, { reason: "     " }, { reason: "no" }, { reason: 7 }]) {
      const res = await reject(as(OFFICER, ["reviewing_officer"]), payload);
      expect(res.statusCode).toBe(400);
    }
    expect(H.reject).not.toHaveBeenCalled();
  });

  it("403 MAKER_CHECKER_VIOLATION when the officer is the report's inspector, author or submitter", async () => {
    for (const who of [INSPECTOR, AUTHOR, SUBMITTER]) {
      const res = await reject(as(who, ["reviewing_officer"]), { reason: "my own report, rejecting it" });
      expect(res.statusCode).toBe(403);
      expect(res.json().error?.code ?? res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    }
    expect(H.reject).not.toHaveBeenCalled();
  });

  it("409s a report that is not submitted (draft, approved, already rejected)", async () => {
    for (const status of ["draft", "approved", "rejected"]) {
      H.find.mockResolvedValue({ id: REPORT, tenantId: TENANT, status, inspectorId: INSPECTOR, createdBy: AUTHOR, updatedBy: AUTHOR, submittedBy: null });
      const res = await reject(as(OFFICER, ["reviewing_officer"]), { reason: "should not matter" });
      expect(res.statusCode).toBe(409);
    }
    expect(H.reject).not.toHaveBeenCalled();
  });

  it("404s a report that does not exist in the tenant", async () => {
    H.find.mockResolvedValue(undefined);
    const res = await reject(as(OFFICER, ["reviewing_officer"]), { reason: "should not matter" });
    expect(res.statusCode).toBe(404);
    expect(H.reject).not.toHaveBeenCalled();
  });
});

describe("resubmission of a rejected report", () => {
  const rejectedReport = { id: REPORT, tenantId: TENANT, status: "rejected", inspectorId: INSPECTOR, createdBy: INSPECTOR, updatedBy: OFFICER, submittedBy: INSPECTOR };

  it("the inspector can submit a rejected report again; an approved one is still 409", async () => {
    H.find.mockResolvedValue(rejectedReport);
    const again = await app.inject({ method: "POST", url: `/v1/inspection/reports/${REPORT}/submit`, headers: as(INSPECTOR, ["inspector"]) });
    expect(again.statusCode).toBe(202);
    expect(H.submit).toHaveBeenCalledTimes(1);

    H.find.mockResolvedValue({ ...rejectedReport, status: "approved" });
    const approved = await app.inject({ method: "POST", url: `/v1/inspection/reports/${REPORT}/submit`, headers: as(INSPECTOR, ["inspector"]) });
    expect(approved.statusCode).toBe(409);
  });

  it("observations may be added to a rejected report so it can be revised, but not to an approved one", async () => {
    const body = { category: "Safety", severity: "major", description: "Exit blocked" };
    H.find.mockResolvedValue(rejectedReport);
    const ok = await app.inject({ method: "POST", url: `/v1/inspection/reports/${REPORT}/observations`, headers: as(INSPECTOR, ["inspector"]), payload: body });
    expect(ok.statusCode).toBe(202);
    H.find.mockResolvedValue({ ...rejectedReport, status: "approved" });
    const no = await app.inject({ method: "POST", url: `/v1/inspection/reports/${REPORT}/observations`, headers: as(INSPECTOR, ["inspector"]), payload: body });
    expect(no.statusCode).toBe(409);
  });

  it("a rejected report cannot be approved or rejected again without being resubmitted", async () => {
    H.find.mockResolvedValue(rejectedReport);
    const approve = await app.inject({ method: "POST", url: `/v1/inspection/reports/${REPORT}/approve`, headers: as(OFFICER, ["reviewing_officer"]) });
    expect(approve.statusCode).toBe(409);
    expect(H.approve).not.toHaveBeenCalled();
  });
});
