/**
 * FQ12 audit-service defects.
 *
 *  #55  PATCH /v1/audit/risks/:id accepted status/mitigationStatus values the DB
 *       CHECKs reject (escalated, mitigated, implemented, accepted): 202, then the
 *       consumer's UPDATE failed and the change was silently dropped. Now 400.
 *  #57  PATCH /v1/audit/vigilance/:id/screen accepted `remarks` but the consumer
 *       dropped them. They are now stored (migration 0035) and carried on the
 *       audit event.
 *  (h)  `_inbox.command_results` was missing, so the outbox purge failed every
 *       cycle. Migration 0034 adds it.
 *
 * Both migrations run twice here to prove they are idempotent.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { vigilanceCases } from "../src/modules/vigilance/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerVigilanceConsumers } from "../src/modules/vigilance/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { drainOrFail } from "../../../vitest.drain";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const CASE_ID = randomUUID();
const RISK_ID = randomUUID();
const REMARKS = `FQ12 screening remarks ${randomUUID()}`;

const auth = (roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-fq12" }, SECRET, 3600)}`,
  "content-type": "application/json",
});

const migration = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");

function wire(q: MemoryQueue): MemoryQueue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}

async function pump(q: MemoryQueue, topic: string, payload: Record<string, unknown>): Promise<void> {
  await q.publish(topic, {
    messageId: randomUUID(), type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0", payload: { tenantId: TENANT, ...payload },
  });
  await drainOrFail(q);
}

let app: FastifyInstance;

beforeAll(async () => {
  for (const m of ["0034_command_results.sql", "0035_vigilance_screening_remarks.sql"]) {
    await sqlClient.unsafe(migration(m));
    await sqlClient.unsafe(migration(m));
  }
  app = await buildApp();
});

afterAll(async () => {
  // vigilance_cases is immutable (DELETE blocked by policy); rows live under a random tenant.
  await app.close();
  await sqlClient.end();
});

describe("#55 PATCH /v1/audit/risks/:id — enums match the DB CHECKs", () => {
  for (const payload of [
    { status: "escalated" }, { status: "mitigated" }, { status: "accepted" }, { status: "mitigating" },
    { mitigationStatus: "implemented" }, { mitigationStatus: "accepted" }, { mitigationStatus: "completed" },
  ]) {
    it(`400 for ${JSON.stringify(payload)} instead of a 202 that is silently dropped`, async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/audit/risks/${RISK_ID}`, headers: auth(["audit_officer"]), payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION_FAILED");
    });
  }

  for (const payload of [{ status: "closed" }, { status: "open" }, { mitigationStatus: "not_started" }, { mitigationStatus: "in_progress" }]) {
    it(`202 for the DB-valid ${JSON.stringify(payload)}`, async () => {
      const res = await app.inject({ method: "PATCH", url: `/v1/audit/risks/${RISK_ID}`, headers: auth(["audit_officer"]), payload });
      expect(res.statusCode).toBe(202);
    });
  }
});

describe("#57 vigilance screen remarks are persisted", () => {
  it("stores the remarks on the case and carries them on the audit event", async () => {
    const q = wire(new MemoryQueue());
    registerVigilanceConsumers(q);
    await q.start();
    await pump(q, COMMANDS.vigilanceIntake, { id: CASE_ID, caseNo: `VIG-FQ12-${CASE_ID.slice(0, 8)}`, officer: "Shri Y", charges: "misconduct" });
    await pump(q, COMMANDS.vigilanceScreen, { caseId: CASE_ID, decision: "admitted", remarks: REMARKS });
    await q.stop();

    const [row] = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(vigilanceCases).where(eq(vigilanceCases.id, CASE_ID))));
    expect(row?.screeningStatus).toBe("admitted");
    expect(row?.screeningRemarks).toBe(REMARKS);

    const events = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT)))));
    const screen = events.map((e) => e.payload as Record<string, unknown>).find((p) => p.action === "screen");
    expect(screen?.newValue).toMatchObject({ decision: "admitted", remarks: REMARKS });

    const file = await app.inject({ method: "GET", url: `/v1/audit/vigilance/${CASE_ID}`, headers: auth(["vigilance_officer"]) });
    expect(file.statusCode).toBe(200);
    expect(file.json().screeningRemarks).toBe(REMARKS);
  });
});

describe("(h) _inbox.command_results exists", () => {
  it("has the shared G-ASYNC-1 shape", async () => {
    const cols = await sqlClient<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = '_inbox' AND table_name = 'command_results' ORDER BY ordinal_position`;
    expect(cols.map((c) => c.column_name)).toEqual(["message_id", "tenant_id", "topic", "status", "reason", "occurred_at"]);
  });

  it("is tenant-isolated (FORCE RLS) and the purge's GUC-less DELETE no longer errors", async () => {
    const [rls] = await sqlClient<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '_inbox.command_results'::regclass`;
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const other = randomUUID();
    const mine = randomUUID();
    await sqlClient.begin(async (q) => {
      await q`select set_config('app.tenant_id', ${TENANT}, true)`;
      await q`INSERT INTO _inbox.command_results (message_id, tenant_id, topic, status) VALUES (${mine}, ${TENANT}, 'fq12.test', 'succeeded')`;
    });
    const seenByOther = await sqlClient.begin(async (q) => {
      await q`select set_config('app.tenant_id', ${other}, true)`;
      return q`SELECT message_id FROM _inbox.command_results WHERE message_id = ${mine}`;
    });
    expect(seenByOther).toHaveLength(0);
    // the exact statement purgeOutbox runs, with no tenant GUC set
    await expect(sqlClient`DELETE FROM _inbox.command_results WHERE occurred_at < now() - interval '7 days'`).resolves.toBeDefined();
  });
});
