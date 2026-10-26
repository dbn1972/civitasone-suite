/**
 * GAP-LEGAL-OPINIONS-04: opinion list and detail return the same field names.
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
const TENANT = "11111111-aaaa-4000-8000-0000000b20a2";
const ACTOR = "00000000-aaaa-4000-8000-0000000b20a2";
const CASE_REM = "22222222-bbbb-4000-8000-0000000b20b2";
const OP_1 = "33333333-cccc-4000-8000-0000000b20a2";
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

describe("GAP-LEGAL-OPINIONS-04: list and detail share one DTO", () => {
  it("list item and detail expose the same keys and counsel/requester values", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/legal/opinions", headers: auth() });
    const detail = await app.inject({ method: "GET", url: `/v1/legal/opinions/${OP_1}`, headers: auth() });
    expect(list.statusCode).toBe(200);
    expect(detail.statusCode).toBe(200);
    const item = (list.json().items as Array<Record<string, unknown>>).find((o) => o.id === OP_1)!;
    const d = detail.json() as Record<string, unknown>;
    expect(Object.keys(item).sort()).toEqual(Object.keys(d).sort());
    expect(item.counselName).toBe("Adv. K. Rao");
    expect(item.soughtBy).toBe("R. Sharma");
    expect(d.counselName).toBe(item.counselName);
    expect(d.soughtBy).toBe(item.soughtBy);
  });
});
