/**
 * F3-02 grievance lifecycle optimistic concurrency (If-Match → 412).
 *
 * The web (GrievanceActions.tsx) sends the version it rendered as an `If-Match`
 * header on every lifecycle PATCH and treats 412 as a dedicated "changed by someone
 * else" conflict. This proves the SERVER is the authority end to end:
 *   - a stale If-Match is rejected with 412 PRECONDITION_FAILED and does NOT write;
 *   - a fresh If-Match succeeds and bumps the version;
 *   - no If-Match keeps the old (unconditional) behaviour for back-compat;
 *   - an unknown id still 404s (not 412), and a malformed If-Match 400s.
 *
 * DB-backed, HTTP round-trip. The grievance routes write directly (non-CQRS), the
 * established pattern on this branch, so no queue drain is needed.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000f3002";
const ACTOR = "cccccccc-3333-4000-8000-0000000f3002";
const NONEXIST = "ffffffff-ffff-4000-8000-0000000f3002";

function headers(roles = ["crm_admin"], extra: Record<string, string> = {}) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-f302" }, SECRET)}`,
    "x-tenant-id": TENANT,
    ...extra,
  };
}

async function cleanup() {
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.grievances WHERE tenant_id = ${TENANT}`.catch(() => {});
    })
    .catch(() => {});
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function inject(method: string, url: string, opts: { payload?: Record<string, unknown>; headers?: Record<string, string> } = {}) {
  const app = await buildApp();
  const res = await app.inject({
    method: method as "GET",
    url,
    headers: opts.headers ?? headers(),
    ...(opts.payload ? { payload: opts.payload } : {}),
  });
  await app.close();
  return res;
}

async function createGrievance(): Promise<{ id: string; version: number }> {
  const res = await inject("POST", "/v1/crm/grievances", {
    payload: {
      citizenName: "Asha Rao",
      category: "water",
      subject: "No water supply for 3 days",
      priority: "normal",
    },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().data.id as string;
  const detail = (await inject("GET", `/v1/crm/grievances/${id}`)).json().data;
  return { id, version: detail.version as number };
}

describe("F3-02: grievance If-Match concurrency", () => {
  it("rejects a stale If-Match with 412 PRECONDITION_FAILED and does not write", async () => {
    const { id, version } = await createGrievance();

    // First clerk forwards using the version they read → version bumps.
    const first = await inject("PATCH", `/v1/crm/grievances/${id}/forward`, {
      payload: { forwardedTo: "Water Board" },
      headers: headers(["crm_admin"], { "If-Match": String(version) }),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.version).toBe(version + 1);

    // Second clerk still holds the OLD version → 412, write rejected.
    const second = await inject("PATCH", `/v1/crm/grievances/${id}/resolve`, {
      payload: { resolution: "Resolved by second clerk (stale)" },
      headers: headers(["crm_admin"], { "If-Match": String(version) }),
    });
    expect(second.statusCode).toBe(412);
    expect(second.json().code).toBe("PRECONDITION_FAILED");

    // The stale write left no trace: still FORWARDED, not DISPOSED.
    const after = (await inject("GET", `/v1/crm/grievances/${id}`)).json().data;
    expect(after.status).toBe("FORWARDED");
    expect(after.resolution ?? null).toBeNull();
    expect(after.version).toBe(version + 1);
  });

  it("accepts a fresh If-Match and bumps the version", async () => {
    const { id, version } = await createGrievance();
    const res = await inject("PATCH", `/v1/crm/grievances/${id}/first-appeal`, {
      payload: { appealReason: "No response within SLA" },
      headers: headers(["crm_admin"], { "If-Match": String(version) }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("APPEAL");
    expect(res.json().data.version).toBe(version + 1);
  });

  it("still works without an If-Match header (backward compatible)", async () => {
    const { id } = await createGrievance();
    const res = await inject("PATCH", `/v1/crm/grievances/${id}/forward`, {
      payload: { forwardedTo: "Revenue Dept" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("FORWARDED");
  });

  it("412 applies to the assign PATCH too", async () => {
    const { id, version } = await createGrievance();
    // Advance once so the stored version moves past `version`.
    await inject("PATCH", `/v1/crm/grievances/${id}/forward`, { payload: { forwardedTo: "Dept A" } });
    const stale = await inject("PATCH", `/v1/crm/grievances/${id}/assign`, {
      payload: { assignedTo: ACTOR },
      headers: headers(["crm_admin"], { "If-Match": String(version) }),
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().code).toBe("PRECONDITION_FAILED");
  });

  it("returns 404 (not 412) for an unknown grievance even with an If-Match", async () => {
    const res = await inject("PATCH", `/v1/crm/grievances/${NONEXIST}/forward`, {
      payload: { forwardedTo: "Nowhere" },
      headers: headers(["crm_admin"], { "If-Match": "1" }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a malformed If-Match with 400", async () => {
    const { id } = await createGrievance();
    const res = await inject("PATCH", `/v1/crm/grievances/${id}/forward`, {
      payload: { forwardedTo: "Dept" },
      headers: headers(["crm_admin"], { "If-Match": "not-a-number" }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_IF_MATCH");
  });
});
