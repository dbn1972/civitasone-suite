/**
 * GAP-KNOWLEDGE-POLICIES-DETAIL-04: reject (return to draft) endpoint.
 * Pinning test: POST /v1/knowledge/policies/:id/reject returns the policy
 * to draft status with audit trail.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0000-4000-8000-0000000e0401";
const AUTHOR = "aaaaaaaa-0000-4000-8000-0000000e0a01";
const APPROVER = "aaaaaaaa-0000-4000-8000-0000000e0a02";

function tok(sub: string, roles: string[]) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess" }, SECRET, 3600);
}

const authorTok = tok(AUTHOR, ["knowledge_user"]);
const approverTok = tok(APPROVER, ["knowledge_admin"]);

let app: FastifyInstance;

function idOf(res: { json: () => unknown }): string {
  const body = res.json() as { id?: string };
  return body.id!;
}

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("GAP-KNOWLEDGE-POLICIES-DETAIL-04: reject endpoint", () => {
  let policyId: string;

  it("create + submit a draft then reject it back to draft", async () => {
    // 1. Create
    const create = await app.inject({
      method: "POST",
      url: "/v1/knowledge/policies",
      headers: { authorization: `Bearer ${authorTok}`, "x-tenant-id": TENANT, "x-correlation-id": "rej-1" },
      payload: { title: "Reject test policy", docType: "sop" },
    });
    expect(create.statusCode).toBe(202);
    policyId = idOf(create);

    // 2. Submit
    const submit = await app.inject({
      method: "POST",
      url: `/v1/knowledge/policies/${policyId}/submit`,
      headers: { authorization: `Bearer ${authorTok}`, "x-tenant-id": TENANT, "x-correlation-id": "rej-2" },
      payload: {},
    });
    expect(submit.statusCode).toBe(202);

    // 3. Reject (by approver)
    const reject = await app.inject({
      method: "POST",
      url: `/v1/knowledge/policies/${policyId}/reject`,
      headers: { authorization: `Bearer ${approverTok}`, "x-tenant-id": TENANT, "x-correlation-id": "rej-3" },
      payload: { reason: "Needs more detail about the policy scope and applicability." },
    });
    expect(reject.statusCode).toBe(202);

    // 4. Verify status returned to draft
    const detail = await app.inject({
      method: "GET",
      url: `/v1/knowledge/policies/${policyId}`,
      headers: { authorization: `Bearer ${approverTok}`, "x-tenant-id": TENANT },
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as { status: string };
    expect(body.status).toBe("draft");
  });

  it("reject requires a reason of at least 10 characters", async () => {
    // Create + submit another
    const create = await app.inject({
      method: "POST",
      url: "/v1/knowledge/policies",
      headers: { authorization: `Bearer ${authorTok}`, "x-tenant-id": TENANT, "x-correlation-id": "rej-4" },
      payload: { title: "Short reason test", docType: "sop" },
    });
    const pid = idOf(create);
    await app.inject({
      method: "POST",
      url: `/v1/knowledge/policies/${pid}/submit`,
      headers: { authorization: `Bearer ${authorTok}`, "x-tenant-id": TENANT, "x-correlation-id": "rej-5" },
      payload: {},
    });

    const reject = await app.inject({
      method: "POST",
      url: `/v1/knowledge/policies/${pid}/reject`,
      headers: { authorization: `Bearer ${approverTok}`, "x-tenant-id": TENANT, "x-correlation-id": "rej-6" },
      payload: { reason: "short" },
    });
    expect(reject.statusCode).toBe(400);
  });

  it("reject on a draft (wrong status) returns 409", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/knowledge/policies",
      headers: { authorization: `Bearer ${authorTok}`, "x-tenant-id": TENANT, "x-correlation-id": "rej-7" },
      payload: { title: "Already draft", docType: "sop" },
    });
    const pid = idOf(create);

    const reject = await app.inject({
      method: "POST",
      url: `/v1/knowledge/policies/${pid}/reject`,
      headers: { authorization: `Bearer ${approverTok}`, "x-tenant-id": TENANT, "x-correlation-id": "rej-8" },
      payload: { reason: "This should fail because it is already a draft document." },
    });
    // draft→draft is an INVALID_TRANSITION since it's the same state (not in TRANSITIONS[draft])
    expect(reject.statusCode).toBe(409);
  });
});
