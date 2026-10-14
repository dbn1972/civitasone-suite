/**
 * GAP-GRANTS-DISBURSEMENTS-DETAIL-03: POST /v1/estab/files/from-module derives the initiating officer
 * from the authenticated session. A client can never raise an eFile in another officer's name, and the
 * forward-to officer must be a real employee.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";

const { resolveActorEmployeeId, verifyEmployeeExists } = vi.hoisted(() => ({
  resolveActorEmployeeId: vi.fn(),
  verifyEmployeeExists: vi.fn(),
}));
vi.mock("../src/shared/hrms-client.js", async (orig) => {
  const real = await orig<typeof import("../src/shared/hrms-client.js")>();
  return { ...real, resolveActorEmployeeId, verifyEmployeeExists };
});

import { buildApp } from "../src/app.js";
import { HrmsUnavailableError } from "../src/shared/hrms-client.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "0e1a5e00-4000-4000-8000-000000000701";
const ACTOR = "0e1a5e00-5000-4000-8000-000000000701";
const SELF_EMP = "0e1a5e00-8000-4000-8000-000000000701";
const OTHER_EMP = "0e1a5e00-8000-4000-8000-000000000702";

const hdr = (roles = ["grant_officer"]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s701" }, SECRET, 3600)}` });
const payload = (extra: Record<string, unknown> = {}) => ({
  refType: "finance_sanction", refId: randomUUID(), subject: "Disbursement approval", dept: "Grants",
  currentWith: OTHER_EMP, approvalChain: "file_noting", initialNote: "Please approve", ...extra,
});
async function post(body: unknown, roles?: string[]) {
  const app = await buildApp();
  const r = await app.inject({ method: "POST", url: "/v1/estab/files/from-module", headers: hdr(roles), payload: body as object });
  await app.close();
  return r;
}

describe("from-module initiator identity", () => {
  beforeEach(() => {
    resolveActorEmployeeId.mockReset().mockResolvedValue(SELF_EMP);
    verifyEmployeeExists.mockReset().mockResolvedValue(true);
  });

  it("rejects an initiatedBy that is not the caller's own employee id", async () => {
    const r = await post(payload({ initiatedBy: OTHER_EMP }));
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("INITIATOR_MISMATCH");
  });
  it("accepts a request with no initiatedBy and derives it from the session", async () => {
    const r = await post(payload());
    expect(r.statusCode).toBe(202);
  });
  it("accepts initiatedBy equal to the caller's own employee id", async () => {
    expect((await post(payload({ initiatedBy: SELF_EMP }))).statusCode).toBe(202);
  });
  it("rejects a caller with no linked employee record", async () => {
    resolveActorEmployeeId.mockResolvedValue(null);
    const r = await post(payload());
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("ACTOR_NOT_EMPLOYEE");
  });
  it("rejects an unknown forward-to officer", async () => {
    verifyEmployeeExists.mockResolvedValue(false);
    const r = await post(payload());
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("FORWARD_TO_UNKNOWN");
  });
  it("fails closed (503) when HRMS cannot confirm identity", async () => {
    resolveActorEmployeeId.mockRejectedValue(new HrmsUnavailableError("down"));
    expect((await post(payload())).statusCode).toBe(503);
  });
  it("rejects forwarding an eFile to the officer who is raising it (segregation of duties)", async () => {
    const r = await post(payload({ currentWith: SELF_EMP }));
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INITIATOR_EQUALS_APPROVER");
  });
  it("rejects initiator == forward-to for a service-account raise too", async () => {
    const r = await post(payload({ initiatedBy: OTHER_EMP, currentWith: OTHER_EMP }), ["service_account"]);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INITIATOR_EQUALS_APPROVER");
  });
  it("lets a service account supply the initiator it acts for", async () => {
    const r = await post(payload({ initiatedBy: OTHER_EMP, currentWith: SELF_EMP }), ["service_account"]);
    expect(r.statusCode).toBe(202);
    expect(resolveActorEmployeeId).not.toHaveBeenCalled();
  });
});
