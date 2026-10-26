/**
 * CLOS3-S5-13 -- the overdue sweeper reads candidates, then transitions them in a separate transaction. A finding
 * closed in between must NOT be overwritten with `overdue` and must NOT emit an escalation. Real database.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import { runWithTenant, withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { findings, complianceNotices } from "../src/modules/findings/schema.js";
import { transitionFindingOverdue } from "../src/modules/findings/overdue.js";
import { EVENTS } from "../src/topics.js";

const TENANT = "c1053000-dead-4000-8000-00000c105300";
const ACTOR = "c1053000-dead-4000-8000-0000000c1053";

const ids: string[] = [];

async function seedOverdueCandidate(): Promise<string> {
  const id = randomUUID();
  ids.push(id);
  await withTenantScope(db, TENANT, async (tx: any) => {
    await tx.insert(findings).values({
      id, tenantId: TENANT, findingNumber: `FND-2026-${id.slice(0, 8)}`,
      inspectionId: randomUUID(), questionId: randomUUID(), provisionId: randomUUID(),
      severity: "major", description: "fire exit blocked", state: "notice_issued",
      evidenceIds: [], createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(complianceNotices).values({
      id: randomUUID(), tenantId: TENANT, findingId: id, dueDate: "2020-01-01",
      requiredAction: "clear exit", responsibleParty: "owner", createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
  return id;
}

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(complianceNotices).where(eq(complianceNotices.tenantId, TENANT));
    await tx.delete(findings).where(eq(findings.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  ids.length = 0;
}

async function findingRow(id: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(findings).where(eq(findings.id, id))));
  return rows[0]!;
}

async function outboxFor(id: string) {
  return runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(and(
      eq(outboxMessages.tenantId, TENANT),
      inArray(outboxMessages.correlationId, [`overdue-check-${id}`, `overdue-notif-${id}`]),
    ))));
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("overdue sweeper transition is guarded on the expected state", () => {
  it("a notice_issued finding becomes overdue and emits both events", async () => {
    const id = await seedOverdueCandidate();
    const before = await findingRow(id);
    // The sweeper's snapshot of the candidate, read before the transition transaction.
    const candidate = before;

    const done = await runWithTenant(TENANT, () => db.transaction((tx) => transitionFindingOverdue(tx, candidate, TENANT)));
    expect(done).toBe(true);
    const after = await findingRow(id);
    expect(after.state).toBe("overdue");
    expect(after.version).toBe(before.version + 1);
    const out = await outboxFor(id);
    expect(out.map((o) => o.topic).sort()).toEqual([EVENTS.findingOverdue, "notification.send"].sort());
  });

  it("a finding closed between the read and the write stays closed and emits nothing", async () => {
    const id = await seedOverdueCandidate();
    // The sweeper's snapshot of the candidate, read before the finding is closed.
    const candidate = await findingRow(id);

    // A user closes the finding after the sweeper read it.
    await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.update(findings).set({ state: "closed", closedAt: new Date(), closedBy: ACTOR }).where(eq(findings.id, id))));
    const closed = await findingRow(id);

    const done = await runWithTenant(TENANT, () => db.transaction((tx) => transitionFindingOverdue(tx, candidate, TENANT)));
    expect(done).toBe(false);
    const after = await findingRow(id);
    expect(after.state).toBe("closed");
    expect(after.version).toBe(closed.version);
    expect(await outboxFor(id)).toHaveLength(0);
  });
});
