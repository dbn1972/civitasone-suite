/**
 * CRM service-request gaps (cluster 10), DB-backed HTTP round-trips:
 *
 *  - GAP-CRM-SERVICE-REQUESTS-DETAIL-03: the status timeline and the Audit card
 *    say WHO acted (actorName / createdByName / updatedByName), never an id.
 *  - GAP-CRM-SERVICE-REQUESTS-DETAIL-05: the detail resolves the assignee to a
 *    name, and PATCH .../assign assigns/reassigns (managers only, active tenant
 *    user only, optimistic-locked, audited).
 *  - GAP-CRM-SERVICE-REQUESTS-NEW-04: the detail shows the linked contact, and
 *    POST .../duplicate-check warns about open requests for the same phone/email.
 *  - GAP-CRM-SERVICE-REQUESTS-NEW-03: create says where the due date came from.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { clearDirectoryCache } from "../src/shared/user-directory.js";

// identity-service owns "is this an active user of the tenant"; stub that one answer.
vi.mock("../src/shared/identity-client.js", () => ({ isActiveTenantUser: vi.fn() }));
import { isActiveTenantUser } from "../src/shared/identity-client.js";

const SECRET = process.env.JWT_SECRET as string; // set by vitest.config.ts
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const OFFICER = randomUUID();
const OFFICER_NAME = "Meera Nair";
const ACTOR_NAME = "Rahul Verma";

function headers(roles = ["crm_admin"], tenant = TENANT) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": tenant,
  };
}

const originalFetch = globalThis.fetch;
/** What identity-service's user-summaries answers; `null` = it is down. */
let identityUsers: Array<{ id: string; name: string }> | null;

const app = await buildApp();

beforeAll(() => {
  globalThis.fetch = (async (url: unknown, init?: unknown) => {
    if (String(url).includes("/identity/internal/user-summaries")) {
      if (identityUsers === null) throw new Error("connect ECONNREFUSED");
      return new Response(JSON.stringify(identityUsers), { status: 200, headers: { "content-type": "application/json" } });
    }
    return originalFetch(url as string, init as RequestInit);
  }) as typeof fetch;
});

beforeEach(() => {
  identityUsers = [
    { id: ACTOR, name: ACTOR_NAME },
    { id: OFFICER, name: OFFICER_NAME },
  ];
  clearDirectoryCache();
  vi.mocked(isActiveTenantUser).mockReset();
  vi.mocked(isActiveTenantUser).mockResolvedValue(true);
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await sqlClient
    .begin(async (tx) => {
      for (const t of [TENANT, OTHER_TENANT]) {
        await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
        await tx`DELETE FROM crm.case_status_history WHERE tenant_id = ${t}`.catch(() => {});
        await tx`DELETE FROM crm.service_requests WHERE tenant_id = ${t}`.catch(() => {});
        await tx`DELETE FROM crm.contacts WHERE tenant_id = ${t}`.catch(() => {});
        await tx`DELETE FROM crm.service_types WHERE tenant_id = ${t}`.catch(() => {});
        await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`.catch(() => {});
      }
    })
    .catch(() => {});
  await app.close();
  await sqlClient.end();
});

async function req(method: string, url: string, payload?: Record<string, unknown>, roles?: string[], tenant?: string) {
  return app.inject({
    method: method as "GET",
    url,
    headers: headers(roles, tenant),
    ...(payload ? { payload } : {}),
  });
}

async function create(extra: Record<string, unknown> = {}, tenant = TENANT): Promise<string> {
  const res = await req(
    "POST",
    "/v1/crm/service-requests",
    { citizenName: "Asha Rao", serviceType: "Birth Certificate", subject: "Certificate correction", ...extra },
    undefined,
    tenant,
  );
  expect(res.statusCode).toBe(201);
  return res.json().data.id as string;
}

async function auditActions(resourceId: string): Promise<string[]> {
  const rows = await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return tx<Array<{ event_type: string }>>`
      SELECT event_type FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND payload->>'resourceId' = ${resourceId}
         OR (tenant_id = ${TENANT} AND payload->>'serviceRequestId' = ${resourceId})
    `;
  });
  return rows.map((r) => r.event_type);
}

describe("GAP-CRM-SERVICE-REQUESTS-DETAIL-03: who acted", () => {
  it("the history timeline carries the actor's NAME, not just an id", async () => {
    const id = await create();
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "in_progress" });
    const res = await req("GET", `/v1/crm/service-requests/${id}/history`);
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ actorId: string; actorName: string | null; toStatus: string }>;
    expect(rows.map((r) => r.toStatus)).toEqual(["open", "in_progress"]);
    for (const r of rows) {
      expect(r.actorId).toBe(ACTOR);
      expect(r.actorName).toBe(ACTOR_NAME);
    }
  });

  it("the detail names who logged and who last changed the request", async () => {
    const id = await create();
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "in_progress" });
    const d = (await req("GET", `/v1/crm/service-requests/${id}`)).json().data;
    expect(d.createdByName).toBe(ACTOR_NAME);
    expect(d.updatedByName).toBe(ACTOR_NAME);
  });

  it("fails OPEN: an unreachable identity-service yields null names, never the raw id, and the page still loads", async () => {
    identityUsers = null;
    const id = await create();
    const detail = await req("GET", `/v1/crm/service-requests/${id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.createdByName).toBeNull();
    expect(detail.json().data.updatedByName).toBeNull();
    const history = await req("GET", `/v1/crm/service-requests/${id}/history`);
    expect(history.statusCode).toBe(200);
    expect(history.json().data[0].actorName).toBeNull();
  });
});

describe("GAP-CRM-SERVICE-REQUESTS-DETAIL-05: assignee name + assign endpoint", () => {
  it("an unassigned request has a null assignee name", async () => {
    const id = await create();
    const d = (await req("GET", `/v1/crm/service-requests/${id}`)).json().data;
    expect(d.assignedTo).toBeNull();
    expect(d.assignedToName).toBeNull();
  });

  it("a manager assigns an active officer; the detail then shows their name", async () => {
    const id = await create();
    const res = await req("PATCH", `/v1/crm/service-requests/${id}/assign`, { assignedTo: OFFICER });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.assignedTo).toBe(OFFICER);
    expect(res.json().data).not.toHaveProperty("fromAssignee");
    expect(vi.mocked(isActiveTenantUser)).toHaveBeenCalledWith(TENANT, OFFICER);
    const d = (await req("GET", `/v1/crm/service-requests/${id}`)).json().data;
    expect(d.assignedToName).toBe(OFFICER_NAME);
    expect(d.assignedTo).toBe(OFFICER);
  });

  it("emits the assignment domain event + audit event in the same transaction", async () => {
    const id = await create();
    await req("PATCH", `/v1/crm/service-requests/${id}/assign`, { assignedTo: OFFICER });
    const events = await auditActions(id);
    expect(events).toContain("crm.service_request.assigned");
    const audit = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx<Array<{ action: string; toAssignee: string | null }>>`
        SELECT payload->>'action' AS action, NULL::text AS "toAssignee" FROM _outbox.messages
        WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record' AND payload->>'resourceId' = ${id}
          AND payload->>'action' = 'assign'
      `;
    });
    expect(audit).toHaveLength(1);
    const evt = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx<Array<{ payload: Record<string, unknown> }>>`
        SELECT payload FROM _outbox.messages
        WHERE tenant_id = ${TENANT} AND event_type = 'crm.service_request.assigned' AND payload->>'serviceRequestId' = ${id}
      `;
    });
    expect(evt[0]!.payload).toMatchObject({ serviceRequestId: id, fromAssignee: null, toAssignee: OFFICER });
  });

  it("a reassignment records the previous owner on the event", async () => {
    const id = await create();
    await req("PATCH", `/v1/crm/service-requests/${id}/assign`, { assignedTo: OFFICER });
    await req("PATCH", `/v1/crm/service-requests/${id}/assign`, { assignedTo: ACTOR });
    const evts = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx<Array<{ payload: Record<string, unknown> }>>`
        SELECT payload FROM _outbox.messages
        WHERE tenant_id = ${TENANT} AND event_type = 'crm.service_request.assigned' AND payload->>'serviceRequestId' = ${id}
        ORDER BY created_at ASC
      `;
    });
    expect(evts.map((e) => e.payload["fromAssignee"])).toEqual([null, OFFICER]);
  });

  it("is manager-only: a plain crm_user is refused (403) and nothing changes", async () => {
    const id = await create();
    const res = await req("PATCH", `/v1/crm/service-requests/${id}/assign`, { assignedTo: OFFICER }, ["crm_user"]);
    expect(res.statusCode).toBe(403);
    expect((await req("GET", `/v1/crm/service-requests/${id}`)).json().data.assignedTo).toBeNull();
  });

  it("refuses an assignee who is not an active user of this tenant (422)", async () => {
    vi.mocked(isActiveTenantUser).mockResolvedValue(false);
    const id = await create();
    const res = await req("PATCH", `/v1/crm/service-requests/${id}/assign`, { assignedTo: randomUUID() });
    expect(res.statusCode).toBe(422);
    expect((await req("GET", `/v1/crm/service-requests/${id}`)).json().data.assignedTo).toBeNull();
  });

  it("fails CLOSED when identity cannot confirm the officer (503), rather than assigning blind", async () => {
    vi.mocked(isActiveTenantUser).mockResolvedValue(undefined);
    const id = await create();
    const res = await req("PATCH", `/v1/crm/service-requests/${id}/assign`, { assignedTo: OFFICER });
    expect(res.statusCode).toBe(503);
    expect((await req("GET", `/v1/crm/service-requests/${id}`)).json().data.assignedTo).toBeNull();
  });

  it("rejects a malformed assignee id (400)", async () => {
    const id = await create();
    const res = await req("PATCH", `/v1/crm/service-requests/${id}/assign`, { assignedTo: "not-a-uuid" });
    expect(res.statusCode).toBe(400);
  });

  it("is optimistic-locked: a stale version is a 409 and does not overwrite", async () => {
    const id = await create();
    const v = (await req("GET", `/v1/crm/service-requests/${id}`)).json().data.version as number;
    expect((await req("PATCH", `/v1/crm/service-requests/${id}/assign`, { assignedTo: OFFICER, version: v })).statusCode).toBe(200);
    const stale = await req("PATCH", `/v1/crm/service-requests/${id}/assign`, { assignedTo: ACTOR, version: v });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("VERSION_CONFLICT");
    expect((await req("GET", `/v1/crm/service-requests/${id}`)).json().data.assignedTo).toBe(OFFICER);
  });

  it("a status change made meanwhile makes an old assign version stale too", async () => {
    const id = await create();
    const v = (await req("GET", `/v1/crm/service-requests/${id}`)).json().data.version as number;
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "in_progress" });
    const res = await req("PATCH", `/v1/crm/service-requests/${id}/assign`, { assignedTo: OFFICER, version: v });
    expect(res.statusCode).toBe(409);
  });

  it("will not reassign a closed request (404, unchanged)", async () => {
    const id = await create();
    await req("PATCH", `/v1/crm/service-requests/${id}/status`, { status: "closed", statusNote: "Closing remarks here" });
    const res = await req("PATCH", `/v1/crm/service-requests/${id}/assign`, { assignedTo: OFFICER });
    expect(res.statusCode).toBe(404);
  });

  it("is tenant-scoped: another tenant's manager cannot assign this request (404)", async () => {
    const id = await create();
    const res = await req("PATCH", `/v1/crm/service-requests/${id}/assign`, { assignedTo: OFFICER }, undefined, OTHER_TENANT);
    expect(res.statusCode).toBe(404);
    expect((await req("GET", `/v1/crm/service-requests/${id}`)).json().data.assignedTo).toBeNull();
  });
});

describe("GAP-CRM-SERVICE-REQUESTS-NEW-04: linked contact + duplicate check", () => {
  async function insertContact(name: string, status = "active"): Promise<string> {
    const cid = randomUUID();
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`INSERT INTO crm.contacts (id, tenant_id, name, status, created_by, updated_by)
               VALUES (${cid}, ${TENANT}, ${name}, ${status}, ${ACTOR}, ${ACTOR})`;
    });
    return cid;
  }

  it("the detail shows the linked contact's name", async () => {
    const cid = await insertContact("Asha Rao (existing)");
    const id = await create({ contactId: cid });
    const d = (await req("GET", `/v1/crm/service-requests/${id}`)).json().data;
    expect(d.contactId).toBe(cid);
    expect(d.contactName).toBe("Asha Rao (existing)");
  });

  it("a request with no linked contact has a null contact name; a deleted contact is not named", async () => {
    const plain = await create();
    expect((await req("GET", `/v1/crm/service-requests/${plain}`)).json().data.contactName).toBeNull();
    const gone = await insertContact("Removed Person", "deleted");
    const id = await create({ contactId: gone });
    expect((await req("GET", `/v1/crm/service-requests/${id}`)).json().data.contactName).toBeNull();
  });

  it("flags an OPEN request for the same phone, however the number was typed", async () => {
    const open = await create({ citizenPhone: "9812345678", serviceType: "Birth Certificate" });
    const ref = (await req("GET", `/v1/crm/service-requests/${open}`)).json().data.referenceNo as string;
    for (const typed of ["9812345678", "+91 98123 45678", "09812345678", "98123-45678"]) {
      const res = await req("POST", "/v1/crm/service-requests/duplicate-check", { phone: typed, serviceType: "Birth Certificate" });
      expect(res.statusCode).toBe(200);
      const data = res.json().data as Array<{ id: string; referenceNo: string; sameServiceType: boolean }>;
      expect(data.map((d) => d.id)).toContain(open);
      expect(data.find((d) => d.id === open)).toMatchObject({ referenceNo: ref, sameServiceType: true });
    }
  });

  it("flags a duplicate by email, case-insensitively, and marks a different service type as not the same", async () => {
    const open = await create({ citizenEmail: "Asha.Dup@Example.com", serviceType: "Birth Certificate" });
    const res = await req("POST", "/v1/crm/service-requests/duplicate-check", {
      email: "asha.dup@example.com",
      serviceType: "Income Certificate",
    });
    const data = res.json().data as Array<{ id: string; sameServiceType: boolean }>;
    expect(data.find((d) => d.id === open)).toMatchObject({ sameServiceType: false });
  });

  it("ignores resolved / closed / cancelled requests - only open work is a duplicate", async () => {
    const closed = await create({ citizenPhone: "9700000001" });
    await req("PATCH", `/v1/crm/service-requests/${closed}/status`, { status: "closed", statusNote: "Closing remarks here" });
    const resolved = await create({ citizenPhone: "9700000001" });
    await req("PATCH", `/v1/crm/service-requests/${resolved}/status`, { status: "resolved", resolution: "Done and dusted" });
    const res = await req("POST", "/v1/crm/service-requests/duplicate-check", { phone: "9700000001" });
    expect(res.json().data).toEqual([]);
  });

  it("is tenant-scoped", async () => {
    await create({ citizenPhone: "9700000002" });
    const res = await req("POST", "/v1/crm/service-requests/duplicate-check", { phone: "9700000002" }, undefined, OTHER_TENANT);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("returns references only - never the citizen's name, phone or email", async () => {
    await create({ citizenPhone: "9700000003", citizenEmail: "pii.check@example.com", citizenName: "Zubin Mehta" });
    const res = await req("POST", "/v1/crm/service-requests/duplicate-check", { phone: "9700000003", email: "pii.check@example.com" });
    const raw = res.body;
    expect(raw).not.toContain("Zubin");
    expect(raw).not.toContain("9700000003");
    expect(raw).not.toContain("pii.check@example.com");
    expect(Object.keys(res.json().data[0]).sort()).toEqual(
      ["createdAt", "id", "referenceNo", "sameServiceType", "serviceType", "status", "subject"].sort(),
    );
  });

  it("needs a phone or an email (400), and a too-short number matches nothing", async () => {
    expect((await req("POST", "/v1/crm/service-requests/duplicate-check", {})).statusCode).toBe(400);
    expect((await req("POST", "/v1/crm/service-requests/duplicate-check", { serviceType: "x" })).statusCode).toBe(400);
    await create({ citizenPhone: "9700000004" });
    const res = await req("POST", "/v1/crm/service-requests/duplicate-check", { phone: "0004" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("is open to any CRM role but not to a caller with none", async () => {
    expect((await req("POST", "/v1/crm/service-requests/duplicate-check", { phone: "9700000005" }, ["crm_user"])).statusCode).toBe(200);
    expect((await req("POST", "/v1/crm/service-requests/duplicate-check", { phone: "9700000005" }, ["citizen"])).statusCode).toBe(403);
  });
});

describe("GAP-CRM-SERVICE-REQUESTS-NEW-03: where the due date came from", () => {
  async function setServiceType(label: string, slaHours: number | null) {
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`INSERT INTO crm.service_types (tenant_id, code, label, active, sla_hours, created_by, updated_by)
               VALUES (${TENANT}, ${label.toUpperCase().replace(/\W/g, "_")}, ${label}, true, ${slaHours}, ${ACTOR}, ${ACTOR})`;
    });
  }

  it("reports 'sla' when derived from the service type's SLA hours", async () => {
    await setServiceType("Trade Licence", 120);
    const res = await req("POST", "/v1/crm/service-requests", {
      citizenName: "A B", serviceType: "Trade Licence", subject: "Renewal", priority: "high",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.dueSource).toBe("sla");
    expect(res.json().data.dueAt).not.toBeNull();
  });

  it("reports 'explicit' when the caller supplies a date", async () => {
    const res = await req("POST", "/v1/crm/service-requests", {
      citizenName: "A B", serviceType: "Trade Licence", subject: "Renewal", dueAt: "2030-01-01T00:00:00.000Z",
    });
    expect(res.json().data.dueSource).toBe("explicit");
  });

  it("reports 'none' - honestly - when the type has no SLA and no date was given", async () => {
    await setServiceType("Unmeasured Service", null);
    const res = await req("POST", "/v1/crm/service-requests", {
      citizenName: "A B", serviceType: "Unmeasured Service", subject: "Anything",
    });
    expect(res.json().data.dueSource).toBe("none");
    expect(res.json().data.dueAt).toBeNull();
  });
});
