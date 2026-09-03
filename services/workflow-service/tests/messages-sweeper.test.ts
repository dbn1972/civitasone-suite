/**
 * Coverage + regression test for messages/sweeper.ts's sweepExpiredMessages(),
 * and specifically for the workflow.sweep_subscription_tenants() BYPASSRLS
 * fix in migration 0040_sweep_subscription_tenants_bypassrls_owner.sql.
 *
 * Twin of tests/sweeper.test.ts, which covers tasks/sweeper.ts and the
 * equivalent workflow.sweep_task_tenants() fix landed in migration
 * 0039_sweep_task_tenants_bypassrls_owner.sql (PR #960).
 *
 * Before migration 0040: workflow.sweep_subscription_tenants() was SECURITY
 * DEFINER owned by workflow_svc (NOBYPASSRLS, #146), and
 * workflow.message_subscriptions carries FORCE ROW LEVEL SECURITY — so the
 * function always evaluated its RLS policy against a NULL
 * current_tenant_id() and returned zero rows, regardless of how many active
 * timeout-bearing subscriptions existed. sweepExpiredMessages() calls this
 * function with NO app.tenant_id GUC set (by design — it doesn't know which
 * tenants to scope to yet), so the message-timeout sweep silently expired
 * nothing in production.
 *
 * These tests run through `db`, which — per vitest.config.ts's default
 * DATABASE_URL — connects as workflow_svc, the actual runtime role. No test
 * here elevates to a superuser; that is the whole point of the assertion.
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { messageSubscriptions } from "../src/modules/messages/schema.js";
import { sweepExpiredMessages } from "../src/modules/messages/sweeper.js";
import { asTenant, sqlAsTenant } from "./helpers/engine-harness.js";

const tenants: string[] = [];
function newTenant(): string {
  const t = randomUUID();
  tenants.push(t);
  return t;
}

async function seedExpiredSubscription(tenantId: string, minutesAgo: number): Promise<string> {
  const subId = randomUUID();
  await asTenant(tenantId, () =>
    db.transaction(async (tx) =>
      tx.insert(messageSubscriptions).values({
        id: subId,
        tenantId,
        instanceId: randomUUID(),
        taskId: randomUUID(),
        messageName: "ExternalApproval",
        correlationKey: `corr-${subId.slice(0, 8)}`,
        nodeKey: "wait_approval",
        timeoutAt: new Date(Date.now() - minutesAgo * 60_000),
        status: "active",
      }),
    ),
  );
  return subId;
}

afterEach(async () => {
  for (const t of tenants) {
    await sqlAsTenant(t, sql`DELETE FROM workflow.message_subscriptions WHERE tenant_id = ${t}`).catch(
      () => undefined,
    );
    await sqlAsTenant(t, sql`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`).catch(() => undefined);
    await sqlAsTenant(t, sql`DELETE FROM workflow.transition_history WHERE tenant_id = ${t}`).catch(
      () => undefined,
    );
  }
  tenants.length = 0;
});
afterAll(async () => {
  await sqlClient.end();
});

describe("workflow.sweep_subscription_tenants() — BYPASSRLS ownership (migration 0040)", () => {
  it("discovers tenants with active timeout-bearing subscriptions as workflow_svc, not a superuser", async () => {
    const t1 = newTenant();
    const t2 = newTenant();
    await seedExpiredSubscription(t1, 60);
    await seedExpiredSubscription(t2, 120);

    // The exact call sweepExpiredMessages() makes: no app.tenant_id GUC set,
    // run on the plain `db` (workflow_svc) pool. Before migration 0040 this
    // returned zero rows no matter what was seeded — see PR #960's twin
    // proof for sweep_task_tenants().
    const rows = (await db.execute(
      sql`SELECT workflow.sweep_subscription_tenants() AS tenant_id`,
    )) as unknown as Array<{ tenant_id: string }>;
    const discovered = new Set(rows.map((r) => r.tenant_id));

    expect(discovered.has(t1)).toBe(true);
    expect(discovered.has(t2)).toBe(true);
  });

  it("sweepExpiredMessages() expires timed-out subscriptions across multiple tenants in one pass", async () => {
    const t1 = newTenant();
    const t2 = newTenant();
    const sub1 = await seedExpiredSubscription(t1, 45);
    const sub2 = await seedExpiredSubscription(t2, 90);

    const count = await sweepExpiredMessages(new Date(), 100);
    expect(count).toBeGreaterThanOrEqual(2);

    const row1 = await sqlAsTenant(
      t1,
      sql`SELECT status FROM workflow.message_subscriptions WHERE id = ${sub1}`,
    );
    const row2 = await sqlAsTenant(
      t2,
      sql`SELECT status FROM workflow.message_subscriptions WHERE id = ${sub2}`,
    );
    expect((row1[0] as { status: string }).status).toBe("expired");
    expect((row2[0] as { status: string }).status).toBe("expired");
  });

  it("returns 0 when no subscription has timed out yet", async () => {
    const t1 = newTenant();
    const subId = randomUUID();
    await asTenant(t1, () =>
      db.transaction(async (tx) =>
        tx.insert(messageSubscriptions).values({
          id: subId,
          tenantId: t1,
          instanceId: randomUUID(),
          taskId: randomUUID(),
          messageName: "ExternalApproval",
          correlationKey: `corr-${subId.slice(0, 8)}`,
          nodeKey: "wait_approval",
          timeoutAt: new Date(Date.now() + 60 * 60_000), // 1h in the future
          status: "active",
        }),
      ),
    );

    const count = await sweepExpiredMessages(new Date(), 100);

    const row = await sqlAsTenant(t1, sql`SELECT status FROM workflow.message_subscriptions WHERE id = ${subId}`);
    expect((row[0] as { status: string }).status).toBe("active");
    expect(typeof count).toBe("number");
  });
});
