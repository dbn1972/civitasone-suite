/**
 * GAP-CRM-GRIEVANCES-NEW-01 -- duplicate-open-grievance warning support.
 *
 * The create form links a grievance to an existing CRM contact and warns when
 * that contact already has an open grievance. GET /v1/crm/grievances therefore
 * accepts `contactId` (one contact) and `open=true` (status <> DISPOSED, the
 * same definition /stats uses for openCount). Both are additive: absent, the
 * list is unchanged. DB-backed, like the sibling grievance suites.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

// Set by vitest.config.ts (env.JWT_SECRET); no literal secret in the source.
const SECRET = process.env.JWT_SECRET as string;

function authHeaders(roles: string[], tid: string): Record<string, string> {
  const jwt = signToken({ sub: randomUUID(), tid, roles, sid: "sess-grv-contact-filter" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": tid };
}

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function create(tid: string, contactId: string | undefined, subject: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/crm/grievances",
    headers: authHeaders(["crm_user"], tid),
    payload: {
      citizenName: "Asha Rao",
      category: "water",
      subject,
      priority: "normal",
      ...(contactId ? { contactId } : {}),
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

describe("GET /v1/crm/grievances contactId + open filters", () => {
  it("returns only the linked contact's grievances, and only the open ones with open=true", async () => {
    const tid = randomUUID();
    const contactId = randomUUID();
    const openId = await create(tid, contactId, "Open complaint");
    const disposedId = await create(tid, contactId, "Old complaint");
    await create(tid, randomUUID(), "Someone else");
    await create(tid, undefined, "Unlinked");

    // Dispose one directly: the filter is what is under test, not the lifecycle.
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${tid}, true)`;
      await tx`UPDATE crm.grievances SET status = 'DISPOSED', resolved_at = now() WHERE id = ${disposedId}`;
    });

    const all = await app.inject({
      method: "GET",
      url: `/v1/crm/grievances?contactId=${contactId}`,
      headers: authHeaders(["crm_user"], tid),
    });
    expect(all.statusCode).toBe(200);
    expect(all.json().data.map((g: { id: string }) => g.id).sort()).toEqual([openId, disposedId].sort());

    const open = await app.inject({
      method: "GET",
      url: `/v1/crm/grievances?contactId=${contactId}&open=true`,
      headers: authHeaders(["crm_user"], tid),
    });
    expect(open.json().data.map((g: { id: string }) => g.id)).toEqual([openId]);
    expect(open.json().meta.total).toBe(1);
  });

  it("does not leak another tenant's grievances for the same contact id", async () => {
    const contactId = randomUUID();
    const tidA = randomUUID();
    const tidB = randomUUID();
    await create(tidA, contactId, "Tenant A complaint");
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/grievances?contactId=${contactId}&open=true`,
      headers: authHeaders(["crm_user"], tidB),
    });
    expect(res.json().data).toEqual([]);
  });

  it("rejects a malformed contactId and an unknown open value", async () => {
    const tid = randomUUID();
    const bad = await app.inject({ method: "GET", url: "/v1/crm/grievances?contactId=nope", headers: authHeaders(["crm_user"], tid) });
    expect(bad.statusCode).toBe(400);
    const badOpen = await app.inject({ method: "GET", url: "/v1/crm/grievances?open=maybe", headers: authHeaders(["crm_user"], tid) });
    expect(badOpen.statusCode).toBe(400);
  });

  it("leaves the unfiltered list unchanged", async () => {
    const tid = randomUUID();
    await create(tid, randomUUID(), "A");
    await create(tid, undefined, "B");
    const res = await app.inject({ method: "GET", url: "/v1/crm/grievances", headers: authHeaders(["crm_user"], tid) });
    expect(res.json().meta.total).toBe(2);
  });
});
