/**
 * UAT F71: POST /v1/hrms/disciplinary-cases/:caseId/close (and /drop) answered
 * 200 but the case never moved. `transition()` put `{ closedAt: new Date() }`
 * on the F3 payload; on the SQS driver the envelope is JSON, so the consumer
 * got an ISO string and Drizzle's PgTimestamp threw
 * `value.toISOString is not a function` on every retry, into the DLQ.
 *
 * MemoryQueue hands the payload over by reference (the Date survives), which
 * is why the in-memory tests never caught it. This test drives the REAL route,
 * captures the envelope it publishes, round-trips it through JSON exactly as
 * the SQS driver does, and delivers it to the REAL F3 consumer on real
 * Postgres.
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as infraQueue } from "../src/shared/infra.js";
import { registerF3_disciplinary_Consumers } from "../src/modules/disciplinary/f3-consumer.js";
import { hrmsDisciplinaryCases, hrmsDisciplinaryEvents } from "../src/modules/disciplinary/schema.js";
import { COMMANDS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();

afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await sqlClient.end(); });

async function seedCase(status: string): Promise<string> {
  const id = randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsDisciplinaryCases).values({
    id, tenantId: TENANT, employeeId: randomUUID(), caseNo: `DC-F71-${id.slice(0, 8)}`,
    proceedingType: "major", status, allegation: "F71 regression", createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return id;
}

/** POST through the real route; return the f3 envelope it published, as SQS would deliver it. */
async function postAndCapture(caseId: string, action: "close" | "drop"): Promise<unknown> {
  const published: unknown[] = [];
  vi.spyOn(infraQueue, "publish").mockImplementation(async (topic: string, msg: unknown) => {
    if (topic === COMMANDS.f3RouteWrite) published.push(msg);
  });
  const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s-f71" }, SECRET);
  const app = await buildApp();
  const r = await app.inject({
    method: "POST", url: `/v1/hrms/disciplinary-cases/${caseId}/${action}`,
    headers: { authorization: `Bearer ${token}` }, payload: { notes: `F71 ${action}` },
  });
  await app.close();
  expect(r.statusCode).toBe(200);
  expect(published).toHaveLength(1);
  return JSON.parse(JSON.stringify(published[0]));
}

async function deliver(envelope: unknown): Promise<MemoryQueue> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (q as any).subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
  registerF3_disciplinary_Consumers(q);
  await q.start();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await q.publish(COMMANDS.f3RouteWrite, envelope as any);
  await q.drain();
  await q.stop();
  return q;
}

async function readCase(caseId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return withTenantScope(db, TENANT, async (tx: any) => {
    const [c] = await tx.select().from(hrmsDisciplinaryCases)
      .where(and(eq(hrmsDisciplinaryCases.tenantId, TENANT), eq(hrmsDisciplinaryCases.id, caseId)));
    const events = await tx.select().from(hrmsDisciplinaryEvents)
      .where(and(eq(hrmsDisciplinaryEvents.tenantId, TENANT), eq(hrmsDisciplinaryEvents.caseId, caseId)));
    return { c, events };
  });
}

describe("F71: disciplinary close/drop survive the JSON (SQS) wire format", () => {
  it.each([
    ["close", "appeal_decided", "closed"],
    ["close", "penalty_imposed", "closed"],
    ["drop", "finding_recorded", "dropped"],
    ["drop", "opened", "dropped"],
  ] as const)("%s from %s -> %s with a valid closed_at", async (action, from, to) => {
    const caseId = await seedCase(from);
    const before = Date.now();
    const envelope = await postAndCapture(caseId, action);
    const q = await deliver(envelope);

    expect(q.dlq).toEqual([]);
    const { c, events } = await readCase(caseId);
    expect(c.status).toBe(to);
    expect(c.closedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(c.closedAt.getTime())).toBe(false);
    // Stamped at request time (route), within this test's window.
    expect(c.closedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(c.closedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(c.version).toBe(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: from, toStatus: to, action, actorId: ACTOR });
  });

  it("dead-letters (non-retryable) an unparseable timestamp instead of looping", async () => {
    const caseId = await seedCase("appeal_decided");
    const envelope = await postAndCapture(caseId, "close") as { payload: { patch: Record<string, unknown> } };
    envelope.payload.patch.closedAt = "not-a-timestamp";
    const q = await deliver(envelope);

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toMatch(/INVALID_TIMESTAMP/);
    const { c, events } = await readCase(caseId);
    expect(c.status).toBe("appeal_decided");
    expect(c.closedAt).toBeNull();
    expect(events).toHaveLength(0);
  });
});
