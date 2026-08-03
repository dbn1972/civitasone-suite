/**
 * DID mapping CQRS consumer tests (DB-backed).
 *
 * Drives create/delete command consumers against MemoryQueue + real Postgres,
 * then asserts persisted state, idempotency, tenant isolation, and audit events.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";

import { db, sqlClient } from "../src/shared/db.js";
import { markProcessed, outboxMessages } from "../src/shared/outbox.js";
import { COMMANDS } from "../src/topics.js";
import { registerDidConsumers } from "../src/modules/did/consumer.js";
import * as didRepo from "../src/modules/did/repo.js";
import { didMappings } from "../src/modules/did/schema.js";

const TENANT_A = "ddddddd1-0000-4000-8000-000000000001";
const TENANT_B = "ddddddd2-0000-4000-8000-000000000002";
const ACTOR = "ddddddd0-0000-4000-8000-0000000000aa";
const TENANTS = [TENANT_A, TENANT_B];

const queue = new MemoryQueue();
registerDidConsumers(queue);

type Cmd = { messageId: string; type: string; tenantId: string; payload: Record<string, unknown> };

async function drive(cmd: Cmd, ready: () => Promise<boolean>): Promise<void> {
  await queue.publish(cmd.type, {
    messageId: cmd.messageId,
    type: cmd.type,
    tenantId: cmd.tenantId,
    actorId: ACTOR,
    correlationId: `corr-${cmd.messageId}`,
    schemaVersion: "1.0",
    payload: cmd.payload,
  });
  const deadline = Date.now() + 5000;
  for (;;) {
    if (await ready()) return;
    if (Date.now() > deadline) throw new Error(`drive(${cmd.type}) timed out`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function processed(messageId: string): Promise<boolean> {
  const r = await sqlClient`select 1 from _inbox.processed where message_id = ${messageId} limit 1`;
  return r.length > 0;
}

async function sqlAsTenant<T>(tenantId: string, fn: (sql: typeof sqlClient) => Promise<T> | T): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

async function createDidMapping(
  tenantId: string,
  didNumber: string,
  active = true,
): Promise<string> {
  const id = randomUUID();
  await drive(
    {
      messageId: id,
      type: COMMANDS.createDidMapping,
      tenantId,
      payload: { id, tenantId, didNumber, label: "Test DID", active },
    },
    async () => (await didRepo.findById(id, tenantId)) !== null,
  );
  return id;
}

async function auditEmitted(tenantId: string, resourceId: string, outcome: string): Promise<boolean> {
  const rows = await sqlAsTenant(tenantId, (sql) => sql`
    select 1 from _outbox.messages
    where tenant_id = ${tenantId} and event_type = 'audit.event.record'
      and payload::text like ${"%" + resourceId + "%"} and payload::text like ${"%" + outcome + "%"}
    limit 1`);
  return rows.length > 0;
}

async function cleanup(): Promise<void> {
  for (const t of TENANTS) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(didMappings).where(eq(didMappings.tenantId, t));
        await tx.delete(outboxMessages).where(inArray(outboxMessages.tenantId, [t]));
      }),
    );
  }
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("DID mapping create", () => {
  it("persists a new mapping with tenant scope", async () => {
    const id = await createDidMapping(TENANT_A, "+918881112222");
    const view = await didRepo.findById(id, TENANT_A);
    expect(view).not.toBeNull();
    expect(view?.didNumber).toBe("+918881112222");
    expect(view?.active).toBe(true);
    expect(view?.tenantId).toBe(TENANT_A);
  });

  it("isolates tenants: mapping invisible to another tenant", async () => {
    const id = await createDidMapping(TENANT_A, "+918882223333");
    expect(await didRepo.findById(id, TENANT_B)).toBeNull();
    expect(await didRepo.findById(id, TENANT_A)).not.toBeNull();
  });
});

describe("DID mapping delete", () => {
  it("removes an existing mapping", async () => {
    const id = await createDidMapping(TENANT_A, "+918883334444");
    const msgId = randomUUID();
    await drive(
      { messageId: msgId, type: COMMANDS.deleteDidMapping, tenantId: TENANT_A, payload: { id, tenantId: TENANT_A } },
      async () => (await didRepo.findById(id, TENANT_A)) === null,
    );
    expect(await didRepo.findById(id, TENANT_A)).toBeNull();
  });

  it("audits rejection when mapping not found", async () => {
    const id = randomUUID();
    const msgId = randomUUID();
    await drive(
      { messageId: msgId, type: COMMANDS.deleteDidMapping, tenantId: TENANT_A, payload: { id, tenantId: TENANT_A } },
      () => processed(msgId),
    );
    expect(await auditEmitted(TENANT_A, id, "rejected_not_found")).toBe(true);
  });
});

describe("DID mapping idempotency", () => {
  it("a redelivered create does not insert twice", async () => {
    const id = await createDidMapping(TENANT_B, "+918884445555");
    await db.transaction(async (tx) => {
      const claimed = await markProcessed(tx, id);
      expect(claimed).toBe(false);
    });
    const rows = await sqlAsTenant(TENANT_B, (sql) => sql`
      select count(*)::int as n from telephony.did_mappings where id = ${id}`);
    expect(rows[0]?.n).toBe(1);
  });
});
