/**
 * GAP-LEGAL-HEARINGS-05: reminder POST role gate, persistence and audit.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { cache } from "../src/shared/infra.js";
import { legalCases } from "../src/modules/cases/schema.js";
import { legalOpinions } from "../src/modules/opinions/schema.js";
import { legalReminders } from "../src/modules/reminders/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerOpinionConsumers } from "../src/modules/opinions/consumer.js";
import { registerReminderConsumers } from "../src/modules/reminders/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-0000000b20a4";
const ACTOR = "00000000-aaaa-4000-8000-0000000b20a4";
const CASE_REM = "22222222-bbbb-4000-8000-0000000b20b4";
const OP_1 = "33333333-cccc-4000-8000-0000000b20a4";
const MSG = (n: number): string => `66666666-cccc-4000-8000-0000000b20${String(n).padStart(2, "0")}`;

const token = (roles: string[] = ["legal_officer"]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET, 3600);
const auth = (roles?: string[]) => ({ authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT });

function wireTenantAwareQueue(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}
const drain = () => new Promise<void>((r) => setTimeout(r, 300));

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(legalReminders).where(eq(legalReminders.tenantId, TENANT));
    await tx.delete(legalOpinions).where(eq(legalOpinions.tenantId, TENANT));
    await tx.delete(legalCases).where(eq(legalCases.tenantId, TENANT));
    for (let i = 1; i <= 10; i++) await tx.delete(processed).where(eq(processed.messageId, MSG(i)));
  }));
  for (const r of ["cases", "opinion", "opinions"]) await cache.invalidateResource(TENANT, r);
}

let app: FastifyInstance;

beforeAll(async () => {
  await wipe();
  await cache.invalidateResource(TENANT, "cases");
  app = await buildApp();
});

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("GAP-LEGAL-HEARINGS-05: case reminder", () => {
  const body = { remindAt: "2099-01-01T09:00:00.000Z", message: "Hearing prep" };

  it("403 for a non-legal role, 401 without a token", async () => {
    const r403 = await app.inject({ method: "POST", url: `/v1/legal/cases/${CASE_REM}/reminder`, headers: auth(["citizen"]), payload: body });
    expect(r403.statusCode).toBe(403);
    const r401 = await app.inject({ method: "POST", url: `/v1/legal/cases/${CASE_REM}/reminder`, payload: body });
    expect(r401.statusCode).toBe(401);
  });

  it("202 accepted; consumer persists the reminder for the actor and writes a legal.reminder.created audit row", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/legal/cases/${CASE_REM}/reminder`, headers: auth(), payload: body });
    expect(res.statusCode).toBe(202);
    const id = res.json().id as string;

    const queue = wireTenantAwareQueue(new MemoryQueue());
    registerReminderConsumers(queue);
    await runWithTenant(TENANT, async () => {
      await queue.publish(COMMANDS.reminderCreate, {
        messageId: MSG(2), type: COMMANDS.reminderCreate,
        tenantId: TENANT, actorId: ACTOR, correlationId: "c-rem", schemaVersion: "1.0",
        payload: { id, tenantId: TENANT, caseId: CASE_REM, remindAt: body.remindAt, message: body.message },
      });
    });
    await drain();
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(legalReminders).where(and(eq(legalReminders.tenantId, TENANT), eq(legalReminders.id, id)))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdBy).toBe(ACTOR);
    const audits = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    const hit = audits.filter((a) => a.eventType === "legal.reminder.created");
    expect(hit).toHaveLength(1);
    expect((hit[0]!.payload as { resourceId?: string }).resourceId).toBe(id);
  });
});
