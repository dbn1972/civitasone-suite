/**
 * GAP-CRM-SERVICE-REQUESTS-DETAIL-01 — the status transition reason must not be
 * crammed into `resolution` for every transition. A Mark-pending waiting note
 * and a Close remark now go to `status_note`; `resolution` means strictly how
 * the request was fulfilled (resolve only) and is never overwritten by a Close.
 *
 * DB-backed, HTTP round-trip (create -> status transitions -> read back).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000de001";
const ACTOR = "cccccccc-3333-4000-8000-0000000de001";

function headers(roles = ["crm_admin"]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`, "x-tenant-id": TENANT };
}

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.service_requests WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

async function inject(method: string, url: string, payload?: Record<string, unknown>) {
  const app = await buildApp();
  const res = await app.inject({ method: method as "GET", url, headers: headers(), ...(payload ? { payload } : {}) });
  await app.close();
  return res;
}

async function create(): Promise<string> {
  const res = await inject("POST", "/v1/crm/service-requests", {
    citizenName: "Asha Rao",
    serviceType: "Birth Certificate",
    subject: "Certificate correction",
    priority: "normal",
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

describe("GAP-CRM-SERVICE-REQUESTS-DETAIL-01: status note vs resolution", () => {
  it("stores a Mark-pending waiting note in status_note, not resolution", async () => {
    const id = await create();
    const res = await inject("PATCH", `/v1/crm/service-requests/${id}/status`, {
      status: "pending",
      statusNote: "Waiting on citizen to submit old certificate",
    });
    expect(res.statusCode).toBe(200);

    const detail = (await inject("GET", `/v1/crm/service-requests/${id}`)).json().data;
    expect(detail.status).toBe("pending");
    expect(detail.statusNote).toBe("Waiting on citizen to submit old certificate");
    // The bug: the waiting note must NOT appear as a resolution.
    expect(detail.resolution ?? null).toBeNull();
    expect(detail.resolvedAt ?? null).toBeNull();
  });

  it("keeps resolution for resolve and does NOT let a Close overwrite it", async () => {
    const id = await create();

    // Resolve with a genuine resolution.
    const resolveRes = await inject("PATCH", `/v1/crm/service-requests/${id}/status`, {
      status: "resolved",
      resolution: "Corrected certificate issued and handed over",
    });
    expect(resolveRes.statusCode).toBe(200);

    // Close with closing remarks — must land in status_note, leaving resolution intact.
    const closeRes = await inject("PATCH", `/v1/crm/service-requests/${id}/status`, {
      status: "closed",
      statusNote: "Closed after citizen confirmation",
    });
    expect(closeRes.statusCode).toBe(200);

    const detail = (await inject("GET", `/v1/crm/service-requests/${id}`)).json().data;
    expect(detail.status).toBe("closed");
    expect(detail.resolution).toBe("Corrected certificate issued and handed over");
    expect(detail.statusNote).toBe("Closed after citizen confirmation");
    expect(detail.resolvedAt).not.toBeNull();
  });
});
