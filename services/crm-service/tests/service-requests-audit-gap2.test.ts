/**
 * GAP2-CRM-SERVICE-REQUESTS-AUDIT-02.
 *
 * Service-request create and status transitions now emit a platform
 * `audit.event.record` outbox row in the SAME transaction as the write
 * (alongside the pre-existing case_status_history timeline row). On the old
 * code only the in-service timeline existed, so these assertions fail.
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

function headers(roles = ["crm_admin"]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-sr-audit" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

const app = await buildApp();

afterAll(async () => {
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.case_status_history WHERE tenant_id = ${TENANT}`.catch(() => {});
      await tx`DELETE FROM crm.service_requests WHERE tenant_id = ${TENANT}`.catch(() => {});
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

async function audit(id: string): Promise<Array<{ action: string; payload: Record<string, unknown> }>> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    const rows = await tx<Array<{ action: string; payload: Record<string, unknown> }>>`
      SELECT payload->>'action' AS action, payload AS payload
      FROM _outbox.messages
      WHERE tenant_id = ${TENANT}
        AND event_type = 'audit.event.record'
        AND payload->>'resourceId' = ${id}
      ORDER BY created_at ASC, id ASC
    `;
    return rows;
  });
}

async function create(): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/crm/service-requests",
    headers: headers(),
    payload: { citizenName: "Asha Rao", serviceType: "Birth Certificate", subject: "Correction" },
  });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

describe("GAP2-CRM-SERVICE-REQUESTS-AUDIT-02", () => {
  it("create emits an audit.event.record (resourceType service_request, action create)", async () => {
    const id = await create();
    const rows = await audit(id);
    expect(rows.length).toBe(1);
    expect(rows[0]!.action).toBe("create");
    expect(rows[0]!.payload.resourceType).toBe("service_request");
  });

  it("a status change emits an audit event plus a domain event carrying fromStatus/toStatus", async () => {
    const id = await create();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/service-requests/${id}/status`,
      headers: headers(),
      payload: { status: "in_progress" },
    });
    expect(res.statusCode).toBe(200);

    const rows = await audit(id);
    expect(rows.map((r) => r.action)).toEqual(["create", "status_changed"]);

    // The fromStatus/toStatus travel on the domain event (crm.service_request.
    // status_changed), while the audit.event.record carries the audit envelope.
    const [domain] = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx<Array<{ payload: Record<string, unknown> }>>`
        SELECT payload FROM _outbox.messages
        WHERE tenant_id = ${TENANT}
          AND event_type = 'crm.service_request.status_changed'
          AND payload->>'serviceRequestId' = ${id}
        LIMIT 1
      `;
    });
    expect(domain!.payload.fromStatus).toBe("open");
    expect(domain!.payload.toStatus).toBe("in_progress");
  });

  it("a stale (409) status write records no audit row", async () => {
    const id = await create();
    const v0 = (await app.inject({ method: "GET", url: `/v1/crm/service-requests/${id}`, headers: headers() })).json().data.version as number;
    await app.inject({ method: "PATCH", url: `/v1/crm/service-requests/${id}/status`, headers: headers(), payload: { status: "in_progress", version: v0 } });
    const stale = await app.inject({ method: "PATCH", url: `/v1/crm/service-requests/${id}/status`, headers: headers(), payload: { status: "pending", version: v0 } });
    expect(stale.statusCode).toBe(409);
    // create + the one successful change only.
    expect((await audit(id)).map((r) => r.action)).toEqual(["create", "status_changed"]);
  });
});
