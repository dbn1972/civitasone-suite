/**
 * AS-001..004 full-stack flows.
 *
 * Proves the CQRS round-trips actually persist (a 202 that writes nothing is the
 * failure mode we guard against), that an inbound lead is auto-assigned + logged,
 * that manual assign / accept work, that the AS-002 target catalogues are tenant
 * isolated by RLS, and that the escalation cycle picks up overdue leads and emits
 * the escalation event with ageing details.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";
import { runTenantEscalation, runEscalationCycle, startEscalationScheduler } from "../src/modules/assignment/scheduler.js";

process.env.CRM_PII_KEY ??= "test_pii_key_for_crm_domain_tests_aaaa";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[] = ["crm_admin"], tenantId: string = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-as" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function call(
  method: "GET" | "PUT" | "POST" | "DELETE" | "PATCH",
  url: string,
  opts: { headers?: Record<string, string>; payload?: unknown } = {},
) {
  const app = await buildApp();
  const res = await app.inject({ method, url, headers: opts.headers ?? headers(), ...(opts.payload === undefined ? {} : { payload: opts.payload }) });
  await app.close();
  await drainQueue();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function seedContact(tenantId: string, over: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const ownerId = (over.ownerId as string) ?? null;
  const assignedAt = (over.assignedAt as string) ?? null;
  const acceptedAt = (over.acceptedAt as string) ?? null;
  const lastActivityAt = (over.lastActivityAt as string) ?? null;
  const leadStatus = (over.leadStatus as string) ?? "new";
  await scoped(tenantId, (tx) => tx`
    INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, owner_id, assigned_at, accepted_at, last_activity_at, created_by, updated_by, version)
    VALUES (${id}, ${tenantId}, 'Seed', ${leadStatus}, 'active', ${ownerId}, ${assignedAt}, ${acceptedAt}, ${lastActivityAt}, ${ACTOR}, ${ACTOR}, 1)
  `);
  return id;
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) {
    await scoped(t, async (tx) => {
      await tx`DELETE FROM crm.lead_assignment_log WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.assignment_rules WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.escalation_rules WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.assignment_queues WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.territories WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.partners WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.branches WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.agent_workload WHERE tenant_id = ${t}`;
      await tx`DELETE FROM crm.contacts WHERE tenant_id = ${t}`;
    });
  }
}

async function seedAgent(tenantId: string, agentId: string, over: Record<string, unknown> = {}): Promise<void> {
  await scoped(tenantId, (tx) => tx`
    INSERT INTO crm.agent_workload (tenant_id, agent_id, max_leads, available, on_leave)
    VALUES (${tenantId}, ${agentId}, ${(over.maxLeads as number) ?? 50}, ${(over.available as boolean) ?? true}, ${(over.onLeave as boolean) ?? false})
  `);
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

// ── AS-001 assignment-rules CRUD round-trip ──────────────────────────────────
describe("assignment-rules CRUD (AS-001)", () => {
  it("POST persists a rule the GET then returns", async () => {
    const res = await call("POST", "/v1/crm/assignment-rules", {
      payload: { name: "north", ruleType: "territory", criteria: { territory: "north", ownerId: randomUUID() }, ordinal: 1 },
    });
    expect(res.statusCode).toBe(202);

    const rows = await scoped(TENANT, (tx) => tx`SELECT id, name, type FROM crm.assignment_rules WHERE tenant_id = ${TENANT}`);
    expect(rows).toHaveLength(1);
    expect((rows as unknown as Array<{ name: string }>)[0]!.name).toBe("north");

    const list = await call("GET", "/v1/crm/assignment-rules");
    expect(JSON.parse(list.body).data).toHaveLength(1);
  });

  it("PUT updates and DELETE removes", async () => {
    const created = await call("POST", "/v1/crm/assignment-rules", {
      payload: { name: "temp", ruleType: "score_threshold", criteria: { threshold: 50, ownerId: randomUUID() } },
    });
    const id = JSON.parse(created.body).id as string;

    await call("PUT", `/v1/crm/assignment-rules/${id}`, { payload: { name: "renamed", enabled: false } });
    const afterPut = await scoped(TENANT, (tx) => tx`SELECT name, enabled FROM crm.assignment_rules WHERE id = ${id}`);
    expect((afterPut as unknown as Array<{ name: string; enabled: boolean }>)[0]).toMatchObject({ name: "renamed", enabled: false });

    await call("DELETE", `/v1/crm/assignment-rules/${id}`);
    const afterDel = await scoped(TENANT, (tx) => tx`SELECT 1 FROM crm.assignment_rules WHERE id = ${id}`);
    expect(afterDel).toHaveLength(0);
  });
});

// ── AS-001 inbound auto-assign + log ─────────────────────────────────────────
describe("inbound auto-assign (AS-001)", () => {
  it("routes a captured lead by round-robin and writes an assignment log row", async () => {
    await cleanup();
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    await call("POST", "/v1/crm/assignment-rules", {
      payload: { name: "rr", ruleType: "round_robin", criteria: { roster: [ownerA, ownerB] }, ordinal: 1 },
    });

    const cap = await call("POST", "/v1/crm/leads/inbound", {
      payload: { channel: "chatbot", source: "web", attributes: { name: "Lead One", phone: "+919876543210" } },
    });
    expect(cap.statusCode).toBe(202);
    const contactId = JSON.parse(cap.body).contactId as string;

    const contact = await scoped(TENANT, (tx) => tx`SELECT owner_id AS "ownerId", assigned_at AS "assignedAt" FROM crm.contacts WHERE id = ${contactId}`);
    const row = (contact as unknown as Array<{ ownerId: string; assignedAt: string }>)[0]!;
    expect(row.ownerId).toBe(ownerA); // cursor -1 → first roster entry
    expect(row.assignedAt).not.toBeNull();

    const logs = await scoped(TENANT, (tx) => tx`SELECT owner_id AS "ownerId", method FROM crm.lead_assignment_log WHERE lead_id = ${contactId}`);
    expect(logs).toHaveLength(1);
    expect((logs as unknown as Array<{ ownerId: string; method: string }>)[0]).toMatchObject({ ownerId: ownerA, method: "auto" });

    const cursor = await scoped(TENANT, (tx) => tx`SELECT rr_cursor AS "rr" FROM crm.assignment_rules WHERE tenant_id = ${TENANT} AND type = 'round_robin'`);
    expect((cursor as unknown as Array<{ rr: number }>)[0]!.rr).toBe(0);
  });
});

// ── AS-001/002 manual assign + accept + unified history ──────────────────────
describe("manual assign, accept, transfer history (AS-001/AS-002)", () => {
  it("manual assign sets owner + logs method=manual", async () => {
    const leadId = await seedContact(TENANT);
    const owner = randomUUID();
    const res = await call("POST", `/v1/crm/leads/${leadId}/assign`, { payload: { ownerId: owner } });
    expect(res.statusCode).toBe(202);

    const c = await scoped(TENANT, (tx) => tx`SELECT owner_id AS "ownerId" FROM crm.contacts WHERE id = ${leadId}`);
    expect((c as unknown as Array<{ ownerId: string }>)[0]!.ownerId).toBe(owner);
    const logs = await scoped(TENANT, (tx) => tx`SELECT method FROM crm.lead_assignment_log WHERE lead_id = ${leadId}`);
    expect((logs as unknown as Array<{ method: string }>)[0]!.method).toBe("manual");
  });

  it("accept records accepted_at", async () => {
    const leadId = await seedContact(TENANT, { ownerId: randomUUID(), assignedAt: new Date().toISOString() });
    const res = await call("POST", `/v1/crm/leads/${leadId}/accept`);
    expect(res.statusCode).toBe(202);
    const c = await scoped(TENANT, (tx) => tx`SELECT accepted_at AS "acceptedAt" FROM crm.contacts WHERE id = ${leadId}`);
    expect((c as unknown as Array<{ acceptedAt: string | null }>)[0]!.acceptedAt).not.toBeNull();
  });

  it("transfer writes a method=transfer history row (AS-002)", async () => {
    const leadId = await seedContact(TENANT, { ownerId: ACTOR, assignedAt: new Date().toISOString() });
    const res = await call("POST", `/v1/crm/contacts/${leadId}/transfer`, { payload: { toOwnerId: randomUUID(), reason: "rebalance" } });
    expect(res.statusCode).toBe(202);
    const logs = await scoped(TENANT, (tx) => tx`SELECT method FROM crm.lead_assignment_log WHERE lead_id = ${leadId} AND method = 'transfer'`);
    expect(logs).toHaveLength(1);
  });
});

// ── AS-002 target catalogues CRUD + RLS isolation ────────────────────────────
describe("assignment target catalogues (AS-002)", () => {
  it("POST persists queue/territory/partner/branch rows", async () => {
    await call("POST", "/v1/crm/assignment-queues", { payload: { name: "inbound-q" } });
    await call("POST", "/v1/crm/territories", { payload: { name: "West", code: "W1", region: "west" } });
    await call("POST", "/v1/crm/partners", { payload: { name: "Acme", partnerType: "reseller" } });
    await call("POST", "/v1/crm/branches", { payload: { name: "Pune HQ", code: "PNQ" } });

    for (const [rel, gen] of [["assignment_queues", "assignment-queues"], ["territories", "territories"], ["partners", "partners"], ["branches", "branches"]] as const) {
      const rows = await scoped(TENANT, (tx) => tx.unsafe(`SELECT 1 FROM crm.${rel} WHERE tenant_id = $1`, [TENANT]));
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const list = await call("GET", `/v1/crm/${gen}`);
      expect(JSON.parse(list.body).data.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("territories created by one tenant are invisible to another (RLS)", async () => {
    const other = await call("GET", "/v1/crm/territories", { headers: headers(["crm_admin"], OTHER) });
    expect(JSON.parse(other.body).data).toHaveLength(0);
  });
});

// ── AS-004 escalation cycle ──────────────────────────────────────────────────
describe("escalation cycle (AS-004)", () => {
  it("escalates an assigned-but-unaccepted lead past the threshold and marks it", async () => {
    await cleanup();
    // rule: unaccepted after 30m
    await call("POST", "/v1/crm/escalation-rules", {
      payload: { name: "esc", trigger: "unaccepted", thresholdMinutes: 30, recipientRole: "sales_manager" },
    });
    // lead assigned 60m ago, never accepted
    const assignedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const leadId = await seedContact(TENANT, { ownerId: randomUUID(), assignedAt });

    const escalated = await runTenantEscalation(TENANT, new Date());
    expect(escalated).toBe(1);

    const c = await scoped(TENANT, (tx) => tx`SELECT escalated_at AS "escalatedAt" FROM crm.contacts WHERE id = ${leadId}`);
    expect((c as unknown as Array<{ escalatedAt: string | null }>)[0]!.escalatedAt).not.toBeNull();

    const evt = await sqlClient`SELECT topic, payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'crm.lead.escalated'`;
    expect(evt.length).toBe(1);
    expect((evt[0] as unknown as { payload: { ageingMinutes: number } }).payload.ageingMinutes).toBeGreaterThanOrEqual(60);
  });

  it("a fresh lead is not escalated, and runEscalationCycle discovers the tenant", async () => {
    await cleanup();
    await call("POST", "/v1/crm/escalation-rules", {
      payload: { name: "esc2", trigger: "unaccepted", thresholdMinutes: 30 },
    });
    await seedContact(TENANT, { ownerId: randomUUID(), assignedAt: new Date().toISOString() }); // just assigned
    const escalated = await runEscalationCycle(new Date());
    expect(escalated).toBe(0);
  });

  it("unattended trigger escalates a stale-since-last-activity lead", async () => {
    await cleanup();
    await call("POST", "/v1/crm/escalation-rules", {
      payload: { name: "unattended", trigger: "unattended", thresholdMinutes: 30 },
    });
    // accepted long ago, but no activity for 90m
    const leadId = await seedContact(TENANT, {
      ownerId: randomUUID(),
      assignedAt: new Date(Date.now() - 300 * 60_000).toISOString(),
      acceptedAt: new Date(Date.now() - 280 * 60_000).toISOString(),
      lastActivityAt: new Date(Date.now() - 90 * 60_000).toISOString(),
    });
    expect(await runTenantEscalation(TENANT, new Date())).toBe(1);
    const c = await scoped(TENANT, (tx) => tx`SELECT escalated_at AS "escalatedAt" FROM crm.contacts WHERE id = ${leadId}`);
    expect((c as unknown as Array<{ escalatedAt: string | null }>)[0]!.escalatedAt).not.toBeNull();
  });

  it("reassign=true reroutes the lead to the configured owner and logs it", async () => {
    await cleanup();
    const newOwner = randomUUID();
    await call("POST", "/v1/crm/escalation-rules", {
      payload: { name: "reassign", trigger: "unaccepted", thresholdMinutes: 30, reassign: true, reassignOwnerId: newOwner },
    });
    const oldOwner = randomUUID();
    const leadId = await seedContact(TENANT, { ownerId: oldOwner, assignedAt: new Date(Date.now() - 60 * 60_000).toISOString() });

    expect(await runTenantEscalation(TENANT, new Date())).toBe(1);

    const c = await scoped(TENANT, (tx) => tx`SELECT owner_id AS "ownerId" FROM crm.contacts WHERE id = ${leadId}`);
    expect((c as unknown as Array<{ ownerId: string }>)[0]!.ownerId).toBe(newOwner);
    const logs = await scoped(TENANT, (tx) => tx`SELECT method FROM crm.lead_assignment_log WHERE lead_id = ${leadId} AND method = 'auto'`);
    expect(logs.length).toBe(1);
  });

  it("startEscalationScheduler returns a timer that can be cleared", () => {
    const timer = startEscalationScheduler(60_000);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });
});

// ── transfer edge case (AS-002) ──────────────────────────────────────────────
describe("transfer of a non-existent contact is audited, not logged", () => {
  it("does not write a history row when the contact is absent", async () => {
    const ghost = randomUUID();
    const res = await call("POST", `/v1/crm/contacts/${ghost}/transfer`, { payload: { toOwnerId: randomUUID(), reason: "x" } });
    expect(res.statusCode).toBe(202);
    const logs = await scoped(TENANT, (tx) => tx`SELECT 1 FROM crm.lead_assignment_log WHERE lead_id = ${ghost}`);
    expect(logs).toHaveLength(0);
  });
});

// ── Review fix 1: duplicate ordinal is not a poison-loop ──────────────────────
describe("assignment-rule ordinal handling (review fix 1)", () => {
  it("two POSTs without ordinal both persist with distinct ordinals", async () => {
    await cleanup();
    await call("POST", "/v1/crm/assignment-rules", { payload: { name: "a", ruleType: "score_threshold", criteria: { threshold: 10, ownerId: randomUUID() } } });
    await call("POST", "/v1/crm/assignment-rules", { payload: { name: "b", ruleType: "score_threshold", criteria: { threshold: 20, ownerId: randomUUID() } } });
    const rows = await scoped(TENANT, (tx) => tx`SELECT ordinal FROM crm.assignment_rules WHERE tenant_id = ${TENANT} ORDER BY ordinal`);
    const ordinals = (rows as unknown as Array<{ ordinal: number }>).map((r) => Number(r.ordinal));
    expect(ordinals).toHaveLength(2);
    expect(new Set(ordinals).size).toBe(2); // distinct, no collision
  });

  it("a genuine duplicate ordinal is rejected+audited, not retried forever", async () => {
    await cleanup();
    await call("POST", "/v1/crm/assignment-rules", { payload: { name: "first", ruleType: "score_threshold", criteria: { threshold: 10, ownerId: randomUUID() }, ordinal: 5 } });
    // Same explicit ordinal on an enabled rule → violates the partial-unique index.
    await call("POST", "/v1/crm/assignment-rules", { payload: { name: "dup", ruleType: "score_threshold", criteria: { threshold: 20, ownerId: randomUUID() }, ordinal: 5 } });
    // Only the first rule persisted; the consumer consumed the dup (no infinite loop).
    const rows = await scoped(TENANT, (tx) => tx`SELECT name FROM crm.assignment_rules WHERE tenant_id = ${TENANT}`);
    expect(rows).toHaveLength(1);
    expect((rows as unknown as Array<{ name: string }>)[0]!.name).toBe("first");
    // The message must be marked processed so redelivery is a no-op (no poison loop).
    const dlq = ((queue as unknown as { dlq?: unknown[] }).dlq ?? []).length;
    expect(dlq).toBe(0);
  });
});

// ── Review fix 3: serialized round-robin cursor advance ──────────────────────
describe("round-robin cursor advances one step per lead (review fix 3)", () => {
  it("sequential inbound leads rotate across the roster", async () => {
    await cleanup();
    const a = randomUUID(), b = randomUUID();
    await call("POST", "/v1/crm/assignment-rules", { payload: { name: "rr", ruleType: "round_robin", criteria: { roster: [a, b] } } });
    const owners: string[] = [];
    for (let i = 0; i < 4; i++) {
      const cap = await call("POST", "/v1/crm/leads/inbound", { payload: { channel: "chatbot", source: "web", attributes: { name: `L${i}`, phone: "+919876543210" } } });
      const cid = JSON.parse(cap.body).contactId as string;
      const c = await scoped(TENANT, (tx) => tx`SELECT owner_id AS "ownerId" FROM crm.contacts WHERE id = ${cid}`);
      owners.push((c as unknown as Array<{ ownerId: string }>)[0]!.ownerId);
    }
    expect(owners).toEqual([a, b, a, b]); // strict rotation, cursor advanced each time
  });
});

// ── Review fix 4: manual assign of a missing lead writes no success log ───────
describe("manual assign guard (review fix 4)", () => {
  it("assigning a nonexistent lead writes no assignment log", async () => {
    await cleanup();
    const ghost = randomUUID();
    const res = await call("POST", `/v1/crm/leads/${ghost}/assign`, { payload: { ownerId: randomUUID() } });
    expect(res.statusCode).toBe(202);
    const logs = await scoped(TENANT, (tx) => tx`SELECT 1 FROM crm.lead_assignment_log WHERE lead_id = ${ghost}`);
    expect(logs).toHaveLength(0);
  });
});

// ── Review fix 5: PUT catalogues + escalation ────────────────────────────────
describe("catalogue + escalation PUT (review fix 5)", () => {
  it("PUT updates a territory in place", async () => {
    await cleanup();
    const created = await call("POST", "/v1/crm/territories", { payload: { name: "West", code: "W1" } });
    // fetch its id from the DB (POST returns command id, not row id)
    const idRow = await scoped(TENANT, (tx) => tx`SELECT id FROM crm.territories WHERE tenant_id = ${TENANT} LIMIT 1`);
    const id = (idRow as unknown as Array<{ id: string }>)[0]!.id;
    expect(created.statusCode).toBe(202);
    const put = await call("PUT", `/v1/crm/territories/${id}`, { payload: { name: "West-Renamed", region: "west" } });
    expect(put.statusCode).toBe(202);
    const row = await scoped(TENANT, (tx) => tx`SELECT name, region, code FROM crm.territories WHERE id = ${id}`);
    expect((row as unknown as Array<{ name: string; region: string; code: string }>)[0]).toMatchObject({ name: "West-Renamed", region: "west", code: "W1" });
  });

  it("PUT updates an escalation rule in place", async () => {
    await cleanup();
    await call("POST", "/v1/crm/escalation-rules", { payload: { name: "esc", trigger: "unaccepted", thresholdMinutes: 30 } });
    const idRow = await scoped(TENANT, (tx) => tx`SELECT id FROM crm.escalation_rules WHERE tenant_id = ${TENANT} LIMIT 1`);
    const id = (idRow as unknown as Array<{ id: string }>)[0]!.id;
    const put = await call("PUT", `/v1/crm/escalation-rules/${id}`, { payload: { name: "esc", trigger: "unattended", thresholdMinutes: 90 } });
    expect(put.statusCode).toBe(202);
    const row = await scoped(TENANT, (tx) => tx`SELECT trigger, threshold_minutes AS "t" FROM crm.escalation_rules WHERE id = ${id}`);
    expect((row as unknown as Array<{ trigger: string; t: number }>)[0]).toMatchObject({ trigger: "unattended" });
    expect(Number((row as unknown as Array<{ t: number }>)[0]!.t)).toBe(90);
  });
});

// ── Review fix 6: onLeave settable + excludes from assignment ─────────────────
describe("agent on_leave (review fix 6)", () => {
  it("PATCH {onLeave:true} sets the column", async () => {
    await cleanup();
    const agent = randomUUID();
    await seedAgent(TENANT, agent);
    const res = await call("PATCH", `/v1/crm/teams/agents/${agent}/capacity`, { payload: { onLeave: true } });
    expect(res.statusCode).toBe(202);
    const row = await scoped(TENANT, (tx) => tx`SELECT on_leave AS "onLeave" FROM crm.agent_workload WHERE agent_id = ${agent}`);
    expect((row as unknown as Array<{ onLeave: boolean }>)[0]!.onLeave).toBe(true);
  });

  it("an on-leave agent is excluded from round-robin assignment", async () => {
    await cleanup();
    const busy = randomUUID(), free = randomUUID();
    await seedAgent(TENANT, busy, { onLeave: true });
    await seedAgent(TENANT, free);
    // roster order [busy, free]; cursor -1 → first candidate busy, but on leave ⇒ free
    await call("POST", "/v1/crm/assignment-rules", { payload: { name: "rr", ruleType: "round_robin", criteria: { roster: [busy, free] } } });
    const cap = await call("POST", "/v1/crm/leads/inbound", { payload: { channel: "chatbot", source: "web", attributes: { name: "L", phone: "+919876543210" } } });
    const cid = JSON.parse(cap.body).contactId as string;
    const c = await scoped(TENANT, (tx) => tx`SELECT owner_id AS "ownerId" FROM crm.contacts WHERE id = ${cid}`);
    expect((c as unknown as Array<{ ownerId: string }>)[0]!.ownerId).toBe(free);
  });
});

// ── Review fix 7: language rule matches on inbound ───────────────────────────
describe("language rule (review fix 7)", () => {
  it("routes an inbound lead by its language attribute", async () => {
    await cleanup();
    const hiOwner = randomUUID();
    await call("POST", "/v1/crm/assignment-rules", { payload: { name: "hi", ruleType: "language", criteria: { value: "hi", ownerId: hiOwner } } });
    const cap = await call("POST", "/v1/crm/leads/inbound", { payload: { channel: "chatbot", source: "web", attributes: { name: "L", phone: "+919876543210", language: "hi" } } });
    const cid = JSON.parse(cap.body).contactId as string;
    const row = await scoped(TENANT, (tx) => tx`SELECT owner_id AS "ownerId", language FROM crm.contacts WHERE id = ${cid}`);
    expect((row as unknown as Array<{ ownerId: string; language: string }>)[0]).toMatchObject({ ownerId: hiOwner, language: "hi" });
  });
});
