/**
 * GAP-LEGAL-OPINIONS-DETAIL-03: submit-approval role gate, 404, consumer state + audit.
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
const TENANT = "11111111-aaaa-4000-8000-0000000b20a3";
const ACTOR = "00000000-aaaa-4000-8000-0000000b20a3";
const CASE_REM = "22222222-bbbb-4000-8000-0000000b20b3";
const OP_1 = "33333333-cccc-4000-8000-0000000b20a3";
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
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(legalOpinions).values({
      id: OP_1, tenantId: TENANT, opinionNo: "OPN/2026/B201", subject: "Subj", question: "Q?",
      soughtBy: "R. Sharma", counselName: "Adv. K. Rao", status: "drafted", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  await cache.invalidateResource(TENANT, "cases");
  app = await buildApp();
});

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("GAP-LEGAL-OPINIONS-DETAIL-03: POST /v1/legal/opinions/:id/submit-approval", () => {
  it("403 for a non-legal role", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/legal/opinions/${OP_1}/submit-approval`, headers: auth(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });

  it("404 NOT_FOUND for an unknown opinion id (no silent 202)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/opinions/99999999-9999-4999-8999-999999999999/submit-approval", headers: auth(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("202 for a real opinion; consumer moves it to pending_approval and writes one audit row", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/legal/opinions/${OP_1}/submit-approval`, headers: auth() });
    expect(res.statusCode).toBe(202);

    const queue = wireTenantAwareQueue(new MemoryQueue());
    registerOpinionConsumers(queue);
    await runWithTenant(TENANT, async () => {
      await queue.publish(COMMANDS.opinionSubmitApproval, {
        messageId: MSG(1), type: COMMANDS.opinionSubmitApproval,
        tenantId: TENANT, actorId: ACTOR, correlationId: "c-sa", schemaVersion: "1.0",
        payload: { opinionId: OP_1, tenantId: TENANT },
      });
    });
    await drain();
    const [row] = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(legalOpinions).where(eq(legalOpinions.id, OP_1))));
    expect(row?.status).toBe("pending_approval");
    const audits = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    const hit = audits.filter((a) => (a.payload as { action?: string }).action === "submit_for_eoffice_approval");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.actorId).toBe(ACTOR);
  });
});
