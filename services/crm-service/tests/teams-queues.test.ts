/**
 * Teams, queues, ownership transfer, and workload tests (AS-002 + AS-003).
 * Tests CRUD for teams, transfer command, agent workload.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS } from "../src/topics.js";
import { captureHandlers, drainQueue, envelope } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000050";
const ACTOR = "cccccccc-3333-4000-8000-000000000050";
const AGENT_ID = "dddddddd-4444-4000-8000-000000000050";

function token(roles = ["crm_admin"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-teams" }, SECRET);
}

function headers(roles = ["crm_admin"]) {
  return {
    authorization: `Bearer ${token(roles)}`,
    "x-tenant-id": TENANT,
  };
}

const CONTACT_ID = "66666666-ffff-4000-8000-000000000001";
const TRANSFER_TARGET = "77777777-aaaa-4000-8000-000000000001";
/** Owned by the transfer-consumer tests only. */
const OWNED_CONTACT_ID = "66666666-ffff-4000-8000-000000000002";
const ORIGINAL_OWNER = "77777777-aaaa-4000-8000-000000000002";
const INACTIVE_CONTACT_ID = "66666666-ffff-4000-8000-000000000003";

async function seedData(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
      VALUES (${CONTACT_ID}, ${TENANT}, 'Transfer Test Contact', 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, owner_id, lead_status, status, version, created_at, updated_at, created_by, updated_by)
      VALUES
        (${OWNED_CONTACT_ID}, ${TENANT}, 'Owned Contact', ${ORIGINAL_OWNER}, 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${INACTIVE_CONTACT_ID}, ${TENANT}, 'Inactive Contact', ${ORIGINAL_OWNER}, 'qualified', 'inactive', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`
      INSERT INTO crm.agent_workload (id, tenant_id, agent_id, max_leads, current_load, available, skills)
      VALUES (gen_random_uuid(), ${TENANT}, ${AGENT_ID}, 50, 10, true, '["sales", "support"]'::jsonb)
      ON CONFLICT DO NOTHING
    `.catch(() => {});
  });
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.lead_queues WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.teams WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.agent_workload WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
    // Emitted events are asserted by exact count below, so a previous run's rows
    // must not carry over.
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

function scoped<T>(fn: (tx: Parameters<Parameters<typeof sqlClient.begin>[0]>[0]) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

beforeAll(async () => {
  await cleanup();
  await seedData();
  registerAllConsumers(queue);
  await queue.start();
});

describe("POST /v1/crm/teams", () => {
  it("accepts the create and the consumer persists the team", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/teams",
      headers: headers(),
      payload: { name: "Sales Team Alpha", territory: { region: "North" } },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");

    await drainQueue();

    const rows = await scoped((tx) => tx`
      SELECT name, territory FROM crm.teams WHERE id = ${body.id} AND tenant_id = ${TENANT}
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Sales Team Alpha");
    expect(rows[0]!.territory).toEqual({ region: "North" });
  });

  it("creates team with empty territory", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/teams",
      headers: headers(),
      payload: { name: "Support Team Beta" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);

    await drainQueue();

    const rows = await scoped((tx) => tx`
      SELECT territory FROM crm.teams WHERE id = ${res.json().id} AND tenant_id = ${TENANT}
    `);
    expect(rows[0]!.territory).toEqual({});
  });

  it("rejects empty name → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/teams",
      headers: headers(),
      payload: { name: "" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/teams",
      payload: { name: "No Auth Team" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/teams",
      headers: { authorization: `Bearer ${token(["crm_user"])}`, "x-tenant-id": TENANT },
      payload: { name: "Forbidden Team" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/teams", () => {
  it("lists teams for tenant", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/teams",
      headers: headers(["crm_user"]),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/teams",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/crm/contacts/:id/transfer", () => {
  it("publishes transfer command → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/transfer`,
      headers: headers(["crm_user"]),
      payload: { toOwnerId: TRANSFER_TARGET, reason: "Reassigning to specialist" },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("rejects missing reason → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/transfer`,
      headers: headers(["crm_user"]),
      payload: { toOwnerId: TRANSFER_TARGET },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid toOwnerId → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/transfer`,
      headers: headers(["crm_user"]),
      payload: { toOwnerId: "not-uuid", reason: "test" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/transfer`,
      payload: { toOwnerId: TRANSFER_TARGET, reason: "test" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

/**
 * The 202 above was the whole story before this consumer existed: ownership
 * never moved, so a reassigned contact stayed on the previous agent's list.
 */
describe("crm.contact.transfer consumer applies the reassignment", () => {
  it("moves ownership and records the outgoing owner in the event", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${OWNED_CONTACT_ID}/transfer`,
      headers: headers(["crm_user"]),
      payload: { toOwnerId: TRANSFER_TARGET, reason: "Territory realignment" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);

    await drainQueue();

    const rows = await scoped((tx) => tx<Array<{ ownerId: string | null; version: number }>>`
      SELECT owner_id AS "ownerId", version FROM crm.contacts
      WHERE id = ${OWNED_CONTACT_ID} AND tenant_id = ${TENANT}
    `);
    expect(rows[0]!.ownerId).toBe(TRANSFER_TARGET);
    expect(rows[0]!.version).toBe(2);

    const events = await scoped((tx) => tx<Array<{ payload: { fromOwnerId: string; toOwnerId: string; reason: string } }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'crm.contact.ownership_transferred'
        AND payload->>'contactId' = ${OWNED_CONTACT_ID}
    `);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload.fromOwnerId).toBe(ORIGINAL_OWNER);
    expect(events[0]!.payload.toOwnerId).toBe(TRANSFER_TARGET);
    expect(events[0]!.payload.reason).toBe("Territory realignment");
  });

  it("leaves an inactive contact untouched and audits the rejection", async () => {
    const { handlerFor } = captureHandlers();
    const handler = handlerFor(COMMANDS.transferOwnership);
    await runWithTenant(TENANT, () => handler(envelope(COMMANDS.transferOwnership, {
      contactId: INACTIVE_CONTACT_ID,
      fromOwnerId: ACTOR,
      toOwnerId: TRANSFER_TARGET,
      reason: "Should not apply",
    }, { tenantId: TENANT, actorId: ACTOR })));

    const rows = await scoped((tx) => tx<Array<{ ownerId: string | null; version: number }>>`
      SELECT owner_id AS "ownerId", version FROM crm.contacts
      WHERE id = ${INACTIVE_CONTACT_ID} AND tenant_id = ${TENANT}
    `);
    expect(rows[0]!.ownerId).toBe(ORIGINAL_OWNER);
    expect(rows[0]!.version).toBe(1);

    const audits = await scoped((tx) => tx<Array<{ payload: { outcome: string; resourceId: string } }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
        AND payload->>'resourceId' = ${INACTIVE_CONTACT_ID}
    `);
    expect(audits.map((a) => a.payload.outcome)).toContain("rejected_not_found");
  });

  it("is idempotent — a redelivered transfer does not bump the row twice", async () => {
    const { handlerFor } = captureHandlers();
    const handler = handlerFor(COMMANDS.transferOwnership);
    const msg = envelope(COMMANDS.transferOwnership, {
      contactId: CONTACT_ID,
      fromOwnerId: ACTOR,
      toOwnerId: TRANSFER_TARGET,
      reason: "Redelivery check",
    }, { tenantId: TENANT, actorId: ACTOR });

    // Settle the transfer the route-level test above published for this contact.
    await drainQueue();
    await runWithTenant(TENANT, () => handler(msg));
    const afterFirst = await scoped((tx) => tx<Array<{ version: number }>>`
      SELECT version FROM crm.contacts WHERE id = ${CONTACT_ID} AND tenant_id = ${TENANT}
    `);
    await runWithTenant(TENANT, () => handler(msg));
    const afterSecond = await scoped((tx) => tx<Array<{ version: number }>>`
      SELECT version FROM crm.contacts WHERE id = ${CONTACT_ID} AND tenant_id = ${TENANT}
    `);
    expect(afterSecond[0]!.version).toBe(afterFirst[0]!.version);
  });
});

describe("GET /v1/crm/teams/agents", () => {
  it("lists agents with workload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/teams/agents",
      headers: headers(["crm_user"]),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].agentId).toBe(AGENT_ID);
    expect(body.data[0].maxLeads).toBe(50);
    expect(body.data[0].available).toBe(true);
  });
});

async function readWorkload(): Promise<{ maxLeads: number; available: boolean }> {
  const rows = await scoped((tx) => tx`
    SELECT max_leads as "maxLeads", available
    FROM crm.agent_workload
    WHERE agent_id = ${AGENT_ID} AND tenant_id = ${TENANT}
  `);
  return rows[0] as { maxLeads: number; available: boolean };
}

describe("PATCH /v1/crm/teams/agents/:agentId/capacity", () => {
  it("accepts the change and the consumer raises maxLeads", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/teams/agents/${AGENT_ID}/capacity`,
      headers: headers(),
      payload: { maxLeads: 100 },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect((await readWorkload()).maxLeads).toBe(100);
  });

  it("updates available status", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/teams/agents/${AGENT_ID}/capacity`,
      headers: headers(),
      payload: { available: false },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect((await readWorkload()).available).toBe(false);
  });

  it("updates both maxLeads and available", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/teams/agents/${AGENT_ID}/capacity`,
      headers: headers(),
      payload: { maxLeads: 75, available: true },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    await drainQueue();
    expect(await readWorkload()).toMatchObject({ maxLeads: 75, available: true });
  });

  it("rejects with no fields → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/teams/agents/${AGENT_ID}/capacity`,
      headers: headers(),
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  // The workload row can be removed between the route's check and the apply;
  // the delivery must settle rather than retry forever, and the audit must not
  // claim the capacity changed.
  it("audits a rejection when the agent row is gone by the time it applies", async () => {
    const missingAgent = "ffffffff-ffff-4000-8000-fffffffffffe";
    const msgId = randomUUID();
    const handler = captureHandlers().handlerFor(COMMANDS.updateAgentCapacity);
    await runWithTenant(TENANT, () =>
      handler(
        envelope(
          COMMANDS.updateAgentCapacity,
          { id: missingAgent, tenantId: TENANT, agentId: missingAgent, maxLeads: 10 },
          { tenantId: TENANT, actorId: ACTOR, messageId: msgId },
        ),
      ),
    );

    const audits = await scoped((tx) => tx<Array<{ outcome: string }>>`
      SELECT payload->>'outcome' AS outcome FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
        AND payload->>'resourceId' = ${missingAgent}
    `);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.outcome).toBe("rejected_agent_not_found");
  });

  it("returns 404 for non-existent agent", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/teams/agents/ffffffff-ffff-4000-8000-ffffffffffff/capacity`,
      headers: headers(),
      payload: { maxLeads: 50 },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/teams/agents/${AGENT_ID}/capacity`,
      headers: { authorization: `Bearer ${token(["crm_user"])}`, "x-tenant-id": TENANT },
      payload: { maxLeads: 50 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
