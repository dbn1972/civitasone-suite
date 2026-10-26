/**
 * GAP-LEGAL-DASHBOARD-06: dashboard counters equal the list-endpoint totals.
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
const TENANT = "11111111-aaaa-4000-8000-0000000b20a1";
const ACTOR = "00000000-aaaa-4000-8000-0000000b20a1";
const CASE_REM = "22222222-bbbb-4000-8000-0000000b20b1";
const OP_1 = "33333333-cccc-4000-8000-0000000b20a1";
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
  const mk = (n: number, status: string) => ({
    id: `44444444-dddd-4000-8000-0000000b20${String(n).padStart(2, "0")}`,
    tenantId: TENANT, caseNo: `B2/${n}/2026`, title: `Case ${n}`, court: "High Court",
    status, createdBy: ACTOR, updatedBy: ACTOR,
  });
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(legalCases).values([
      mk(1, "pending"), mk(2, "appealed"), mk(3, "stayed"), mk(4, "disposed"), mk(5, "settled"),
    ]);
  }));
  await cache.invalidateResource(TENANT, "cases");
  app = await buildApp();
});

afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("GAP-LEGAL-DASHBOARD-06: dashboard counters equal list totals", () => {
  const listTotal = async (status?: string): Promise<number> => {
    const res = await app.inject({
      method: "GET", url: `/v1/legal/cases${status ? `?status=${status}` : ""}`, headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    return (res.json().items as unknown[]).length;
  };

  it("activeCases = pending + appealed + stayed list totals; disposed/total match too", async () => {
    const dash = await app.inject({ method: "GET", url: "/v1/legal/dashboard", headers: auth() });
    expect(dash.statusCode).toBe(200);
    const d = dash.json();
    const active = (await listTotal("pending")) + (await listTotal("appealed")) + (await listTotal("stayed"));
    const disposed = (await listTotal("disposed")) + (await listTotal("settled"));
    expect(d.activeCases).toBe(3);
    expect(d.activeCases).toBe(active);
    expect(d.disposedCases).toBe(2);
    expect(d.disposedCases).toBe(disposed);
    expect(d.totalCases).toBe(await listTotal());
    expect(d.totalCases).toBe(d.activeCases + d.disposedCases);
  });
});
