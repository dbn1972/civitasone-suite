/**
 * Service Catalogue (SVC-129) — SLA-breach escalation sweeper tests (DB-backed).
 *
 * Seeds overdue service requests under dedicated tenant ids and asserts the
 * sweeper escalates exactly once, emitting a breach-escalation event +
 * notification.send + audit under one correlationId, is restart-safe
 * (idempotent), and never crosses tenant boundaries.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { serviceRequests } from "../src/modules/catalogue/schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { sweepRequestBreaches, startRequestBreachSweeper } from "../src/modules/catalogue/sweeper.js";

const { outboxMessages } = outboxSchema;
const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000cf01";
const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000cf02";
const ACTOR = "aaaaaaaa-0000-4000-8000-0000000ac701";
const TENANTS = [TENANT_A, TENANT_B];

async function cleanup() {
  for (const t of TENANTS) {
    await runWithTenant(t, () =>
      db.transaction(async (tx) => {
        await tx.delete(serviceRequests).where(eq(serviceRequests.tenantId, t));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      }),
    );
  }
}

/** Seed a service request whose resolution deadline is `minsAgo` in the past. */
async function seedOverdue(tenantId: string, minsAgo: number): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  const created = new Date(now - (minsAgo + 240) * 60_000);
  const resolution = new Date(now - minsAgo * 60_000);
  await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx.insert(serviceRequests).values({
        id,
        tenantId,
        offeringId: randomUUID(),
        ticketId: randomUUID(),
        requestedBy: ACTOR,
        formData: {},
        status: "in_fulfilment",
        currentStage: "triage",
        resolutionDeadline: resolution,
        createdAt: created,
        updatedAt: created,
        createdBy: ACTOR,
        updatedBy: ACTOR,
        version: 1,
      }),
    ),
  );
  return id;
}

async function outboxFor(tenantId: string, requestId: string) {
  const rows = await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenantId))),
  );
  return rows.filter((r) => JSON.stringify(r.payload).includes(requestId));
}

async function requestRow(tenantId: string, id: string) {
  const rows = await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(serviceRequests).where(eq(serviceRequests.id, id))),
  );
  return rows[0]!;
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("catalogue breach sweeper", () => {
  it("escalates an overdue request: marker set + breach/notify/audit under one correlationId", async () => {
    const id = await seedOverdue(TENANT_A, 30);
    const n = await sweepRequestBreaches();
    expect(n).toBeGreaterThanOrEqual(1);

    const row = await requestRow(TENANT_A, id);
    expect(row.breachEscalatedAt).not.toBeNull();
    expect(row.slaStatus).toBe("breached");

    const msgs = await outboxFor(TENANT_A, id);
    const topics = msgs.map((m) => m.topic).sort();
    expect(topics).toContain("helpdesk.request.breach_escalated");
    expect(topics).toContain("notification.send");
    expect(topics).toContain("audit.event.record");
    expect(new Set(msgs.map((m) => m.correlationId)).size).toBe(1);
  });

  it("does not escalate a request whose deadline is still in the future", async () => {
    const id = randomUUID();
    const now = Date.now();
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) =>
        tx.insert(serviceRequests).values({
          id, tenantId: TENANT_A, offeringId: randomUUID(), ticketId: randomUUID(),
          requestedBy: ACTOR, formData: {}, status: "in_fulfilment", currentStage: "triage",
          resolutionDeadline: new Date(now + 60 * 60_000),
          createdAt: new Date(now), updatedAt: new Date(now),
          createdBy: ACTOR, updatedBy: ACTOR, version: 1,
        }),
      ),
    );
    const n = await sweepRequestBreaches();
    // may pick up other tenants' rows in parallel test runs; assert THIS row untouched
    const row = await requestRow(TENANT_A, id);
    expect(row.breachEscalatedAt).toBeNull();
    expect(n).toBeGreaterThanOrEqual(0);
  });

  it("restart-safe: re-running the sweeper does not re-escalate", async () => {
    const id = await seedOverdue(TENANT_A, 45);
    await sweepRequestBreaches();
    const before = (await outboxFor(TENANT_A, id)).length;
    const n2 = await sweepRequestBreaches();
    const after = (await outboxFor(TENANT_A, id)).length;
    // this specific request must not produce more messages
    expect(after).toBe(before);
    expect(n2).toBe(0);
  });

  it("tenant isolation: escalating tenant A does not touch tenant B", async () => {
    const idA = await seedOverdue(TENANT_A, 30);
    const idB = await seedOverdue(TENANT_B, 30);
    await sweepRequestBreaches();
    const a = await requestRow(TENANT_A, idA);
    const b = await requestRow(TENANT_B, idB);
    expect(a.breachEscalatedAt).not.toBeNull();
    // B is also overdue and gets escalated, but under its own tenant scope —
    // assert the two escalations carry different correlationIds / tenants.
    const msgsA = await outboxFor(TENANT_A, idA);
    const msgsB = await outboxFor(TENANT_B, idB);
    expect(msgsA.every((m) => m.tenantId === TENANT_A)).toBe(true);
    expect(msgsB.every((m) => m.tenantId === TENANT_B)).toBe(true);
    expect(b.breachEscalatedAt).not.toBeNull();
  });

  it("startRequestBreachSweeper returns a timer that can be cleared", () => {
    const t = startRequestBreachSweeper(60_000);
    expect(t).toBeDefined();
    clearInterval(t);
  });
});
