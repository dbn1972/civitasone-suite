/**
 * GAP-CRM-ESCALATION-RULES-05 follow-up: the route-level duplicate check is
 * check-then-act, so a racing duplicate reaches uq_escalation_rules_dedupe
 * (23505) inside the upsert consumer. The consumer must CONSUME that message
 * (markProcessed + an audited rejection, one transaction) instead of rethrowing
 * and redelivering forever.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { captureHandlers, envelope } from "./consumer-harness.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const FIRST = randomUUID();
const SECOND = randomUUID();

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

const rule = (id: string) => ({
  id, tenantId: TENANT, name: "Escalate unaccepted after 1h", trigger: "unaccepted",
  thresholdMinutes: 60, recipientRole: "sales_manager",
});

async function cleanup(): Promise<void> {
  await scoped(async (tx) => {
    await tx`DELETE FROM crm.escalation_rules WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  }).catch(() => {});
}

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("upsertEscalationRule consumer: unique-index race", () => {
  it("consumes a duplicate (23505) message: no throw, inbox marked, rejection audited, one row persisted", async () => {
    const handler = captureHandlers().handlerFor(COMMANDS.upsertEscalationRule);
    await runWithTenant(TENANT, () => handler(envelope(COMMANDS.upsertEscalationRule, rule(FIRST), { tenantId: TENANT, actorId: ACTOR })));

    const dupMsgId = randomUUID();
    await expect(
      runWithTenant(TENANT, () => handler(envelope(COMMANDS.upsertEscalationRule, rule(SECOND), { tenantId: TENANT, actorId: ACTOR, messageId: dupMsgId }))),
    ).resolves.toBeUndefined();

    const rows = await scoped((tx) => tx`SELECT id FROM crm.escalation_rules WHERE tenant_id = ${TENANT}`);
    expect(rows.map((r) => r.id)).toEqual([FIRST]);

    const inbox = await sqlClient`SELECT 1 FROM _inbox.processed WHERE message_id = ${dupMsgId}`;
    expect(inbox.length).toBe(1);

    const audits = await scoped((tx) => tx<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record' AND payload->>'resourceId' = ${SECOND}`);
    expect(audits.map((a) => a.payload)).toEqual([
      expect.objectContaining({ action: "escalation_rule_upsert", resourceType: "escalation_rule", outcome: "rejected_duplicate" }),
    ]);
  });

  it("a redelivery of the consumed duplicate is a no-op (idempotent)", async () => {
    const handler = captureHandlers().handlerFor(COMMANDS.upsertEscalationRule);
    const msg = envelope(COMMANDS.upsertEscalationRule, rule(randomUUID()), { tenantId: TENANT, actorId: ACTOR });
    await runWithTenant(TENANT, () => handler(msg));
    await expect(runWithTenant(TENANT, () => handler(msg))).resolves.toBeUndefined();
    const audits = await scoped((tx) => tx`
      SELECT 1 FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record' AND payload->>'outcome' = 'rejected_duplicate'`);
    // One per distinct duplicate message; none added by the redelivery.
    expect(audits.length).toBe(2);
  });
});
