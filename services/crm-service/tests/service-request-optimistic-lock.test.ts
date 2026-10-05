/**
 * GAP-CRM-SERVICE-REQUESTS-DETAIL-03 — optimistic concurrency on the status
 * PATCH. When the caller sends the `version` it read, a stale write (someone
 * else already advanced the request) must be rejected with 409 VERSION_CONFLICT
 * rather than silently overwriting. A fresh version succeeds.
 *
 * GAP-CRM-SERVICE-REQUESTS-DETAIL-05 — "cancelled" is a supported terminal
 * state the UI can now reach via a Cancel action.
 *
 * DB-backed, HTTP round-trip.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000de002";
const ACTOR = "cccccccc-3333-4000-8000-0000000de002";

function headers(roles = ["crm_admin"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function cleanup() {
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.service_requests WHERE tenant_id = ${TENANT}`.catch(() => {});
    })
    .catch(() => {});
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

async function inject(method: string, url: string, payload?: Record<string, unknown>) {
  const app = await buildApp();
  const res = await app.inject({
    method: method as "GET",
    url,
    headers: headers(),
    ...(payload ? { payload } : {}),
  });
  await app.close();
  return res;
}

async function create(): Promise<{ id: string }> {
  const res = await inject("POST", "/v1/crm/service-requests", {
    citizenName: "Asha Rao",
    serviceType: "Birth Certificate",
    subject: "Certificate correction",
    priority: "normal",
  });
  expect(res.statusCode).toBe(201);
  return { id: res.json().data.id as string };
}

describe("GAP-CRM-SERVICE-REQUESTS-DETAIL-03: optimistic locking", () => {
  it("rejects a stale version with 409 VERSION_CONFLICT and does not overwrite", async () => {
    const { id } = await create();
    const created = (await inject("GET", `/v1/crm/service-requests/${id}`)).json().data;
    const staleVersion = created.version as number;

    // First officer advances the request using the version they read.
    const first = await inject("PATCH", `/v1/crm/service-requests/${id}/status`, {
      status: "in_progress",
      version: staleVersion,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.version).toBe(staleVersion + 1);

    // Second officer still holds the OLD version — must be rejected, not applied.
    const second = await inject("PATCH", `/v1/crm/service-requests/${id}/status`, {
      status: "pending",
      statusNote: "stale write",
      version: staleVersion,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error?.code ?? second.json().code).toBe("VERSION_CONFLICT");

    // The stale write left no trace.
    const after = (await inject("GET", `/v1/crm/service-requests/${id}`)).json().data;
    expect(after.status).toBe("in_progress");
    expect(after.statusNote ?? null).toBeNull();
  });

  it("accepts a fresh version", async () => {
    const { id } = await create();
    const v0 = (await inject("GET", `/v1/crm/service-requests/${id}`)).json().data.version as number;
    const res = await inject("PATCH", `/v1/crm/service-requests/${id}/status`, {
      status: "in_progress",
      version: v0,
    });
    expect(res.statusCode).toBe(200);
  });

  it("still works without a version (backward compatible)", async () => {
    const { id } = await create();
    const res = await inject("PATCH", `/v1/crm/service-requests/${id}/status`, {
      status: "in_progress",
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("GAP-CRM-SERVICE-REQUESTS-05: list exposes per-status counts", () => {
  it("returns statusCounts that sum to the register total", async () => {
    // Three fresh requests, then move two of them so the register spans statuses.
    const a = await create();
    const b = await create();
    await create();
    await inject("PATCH", `/v1/crm/service-requests/${a.id}/status`, { status: "in_progress" });
    await inject("PATCH", `/v1/crm/service-requests/${b.id}/status`, { status: "pending", statusNote: "waiting" });

    const res = await inject("GET", "/v1/crm/service-requests?limit=1&page=1");
    expect(res.statusCode).toBe(200);
    const meta = res.json().meta as { total: number; statusCounts: Record<string, number> };
    expect(meta.statusCounts).toBeDefined();
    // Counts cover the whole register, not the 1-row page.
    const sum = Object.values(meta.statusCounts).reduce((s, n) => s + n, 0);
    expect(sum).toBe(meta.total);
    expect(meta.statusCounts.in_progress).toBeGreaterThanOrEqual(1);
    expect(meta.statusCounts.pending).toBeGreaterThanOrEqual(1);
    expect(meta.statusCounts.open).toBeGreaterThanOrEqual(1);
  });
});

describe("GAP-CRM-SERVICE-REQUESTS-NEW-03: intake channel is captured", () => {
  it("persists intakeChannel on create and returns it on the detail", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/service-requests",
      headers: headers(),
      payload: {
        citizenName: "Asha Rao",
        serviceType: "Birth Certificate",
        subject: "Certificate correction",
        priority: "normal",
        intakeChannel: "walk_in",
        dueAt: new Date("2026-10-20T00:00:00.000Z").toISOString(),
      },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    const id = res.json().data.id as string;
    expect(res.json().data.intakeChannel).toBe("walk_in");

    const detail = (await inject("GET", `/v1/crm/service-requests/${id}`)).json().data;
    expect(detail.intakeChannel).toBe("walk_in");
    expect(detail.dueAt).not.toBeNull();
  });

  it("rejects an unknown intake channel", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/service-requests",
      headers: headers(),
      payload: {
        citizenName: "Asha Rao",
        serviceType: "Birth Certificate",
        subject: "x",
        intakeChannel: "carrier_pigeon",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GAP-CRM-SERVICE-REQUESTS-DETAIL-05: cancel is a reachable terminal state", () => {
  it("cancels an open request and makes it terminal", async () => {
    const { id } = await create();
    const res = await inject("PATCH", `/v1/crm/service-requests/${id}/status`, {
      status: "cancelled",
      statusNote: "Filed in error",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("cancelled");

    const detail = (await inject("GET", `/v1/crm/service-requests/${id}`)).json().data;
    expect(detail.status).toBe("cancelled");
    expect(detail.closedAt).not.toBeNull();

    // A terminal request can no longer be transitioned (404, not reopened).
    const again = await inject("PATCH", `/v1/crm/service-requests/${id}/status`, {
      status: "in_progress",
    });
    expect(again.statusCode).toBe(404);
  });
});
