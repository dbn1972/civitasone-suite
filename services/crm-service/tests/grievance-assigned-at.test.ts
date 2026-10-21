/**
 * GAP-CRM-GRIEVANCES-DETAIL-04 -- the grievance detail timeline's "Assigned" step needs a
 * real time. PATCH /assign now stamps crm.grievances.assigned_at (migration 0162) and the
 * detail endpoint returns it as `assignedAt`; a grievance that has never been assigned
 * reports null (not a made-up time).
 *
 * DB-backed HTTP round-trip.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const ASSIGNEE = randomUUID();
const OTHER_ASSIGNEE = randomUUID();

function headers(roles = ["crm_user"]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-grv-assigned" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

const app = await buildApp();

afterAll(async () => {
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.grievances WHERE tenant_id = ${TENANT}`.catch(() => {});
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

async function createGrievance(): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/crm/grievances", headers: headers(),
    payload: { citizenName: "Ramesh Kumar", category: "Water Supply", subject: "No water for 3 days" },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}
async function detail(id: string): Promise<Record<string, unknown>> {
  const res = await app.inject({ method: "GET", url: `/v1/crm/grievances/${id}`, headers: headers() });
  expect(res.statusCode).toBe(200);
  return res.json().data as Record<string, unknown>;
}
async function assign(id: string, assignedTo: string) {
  return app.inject({ method: "PATCH", url: `/v1/crm/grievances/${id}/assign`, headers: headers(), payload: { assignedTo } });
}

describe("GAP-CRM-GRIEVANCES-DETAIL-04: assigned_at", () => {
  it("reports assignedAt: null for a grievance nobody has been assigned to", async () => {
    const id = await createGrievance();
    const d = await detail(id);
    expect(d.assignedTo ?? null).toBeNull();
    expect(d.assignedAt).toBeNull();
  });

  it("stamps the assignment time on assign and returns it from both the PATCH and the detail GET", async () => {
    const id = await createGrievance();
    const before = Date.now();
    const res = await assign(id, ASSIGNEE);
    expect(res.statusCode).toBe(200);
    const patched = res.json().data as { assignedAt: string; assignedTo: string };
    expect(patched.assignedTo).toBe(ASSIGNEE);

    const d = await detail(id);
    expect(d.assignedTo).toBe(ASSIGNEE);
    expect(typeof d.assignedAt).toBe("string");
    const at = Date.parse(d.assignedAt as string);
    expect(Number.isNaN(at)).toBe(false);
    // "now" as the database saw it: within a generous window around the call.
    expect(at).toBeGreaterThan(before - 60_000);
    expect(at).toBeLessThan(Date.now() + 60_000);
    expect(d.assignedAt).toBe(patched.assignedAt);
  });

  it("re-assigning moves the stamp forward to the latest assignment", async () => {
    const id = await createGrievance();
    await assign(id, ASSIGNEE);
    const first = Date.parse((await detail(id)).assignedAt as string);
    await new Promise((r) => setTimeout(r, 25));
    await assign(id, OTHER_ASSIGNEE);
    const d = await detail(id);
    expect(d.assignedTo).toBe(OTHER_ASSIGNEE);
    expect(Date.parse(d.assignedAt as string)).toBeGreaterThan(first);
  });

  it("does not touch assigned_at when the grievance is forwarded to a department", async () => {
    const id = await createGrievance();
    const fwd = await app.inject({
      method: "PATCH", url: `/v1/crm/grievances/${id}/forward`, headers: headers(),
      payload: { forwardedTo: "Water Dept" },
    });
    expect(fwd.statusCode).toBe(200);
    const d = await detail(id);
    expect(d.forwardedAt).toBeTruthy();
    expect(d.assignedAt).toBeNull();
  });
});
