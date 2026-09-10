/**
 * TX-004 — Campaign approval consumer regression tests.
 *
 * Drives the REAL consumer (registerCampaignApprovalConsumers, via
 * registerAllConsumers) directly through captureHandlers/runWithTenant so a
 * redelivered messageId can be replayed deterministically (the route-level
 * tests in campaign-approval.test.ts only assert the 202 response).
 *
 * Covers the TX-004 DoD:
 *  - the write goes through a real write path (db.transaction), not the
 *    scopedRead helper, and is idempotent: a redelivered approve/reject/submit
 *    command does not double-apply (status/approved_by/rejected_by/version
 *    change exactly once).
 *  - every transition leaves a real audit trail: a domain event AND an
 *    audit.event.record row land in _outbox.messages in the SAME transaction.
 *  - submitCampaignForApproval is a real handler (not a no-op stub): it emits
 *    its own domain + audit event, also idempotently.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { runWithTenant } from "@civitasone/db";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { captureHandlers, envelope } from "./consumer-harness.js";

const TENANT = "aaaaaaaa-1111-4000-8000-0000ca00b001";
const ACTOR = "cccccccc-3333-4000-8000-0000ca00b001";
const TEMPLATE_ID = "88888888-cccc-4000-8000-0000ca00b003";
const CONTACT_IDS = ["11111111-aaaa-4000-8000-0000ca00b004", "22222222-bbbb-4000-8000-0000ca00b005"];

const APPROVE_CAMPAIGN_ID = "99999999-dddd-4000-8000-0000ca00b011";
const REJECT_CAMPAIGN_ID = "99999999-dddd-4000-8000-0000ca00b012";
const SUBMIT_CAMPAIGN_ID = "99999999-dddd-4000-8000-0000ca00b013";

function scoped<T>(fn: (tx: Parameters<Parameters<typeof sqlClient.begin>[0]>[0]) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function seedPendingCampaigns(): Promise<void> {
  await scoped((tx) => tx`
    INSERT INTO crm.pending_campaigns (id, tenant_id, channel, template_id, contact_ids, variables, created_by)
    VALUES
      (${APPROVE_CAMPAIGN_ID}, ${TENANT}, 'email', ${TEMPLATE_ID}, ${JSON.stringify(CONTACT_IDS)}::jsonb, '{}'::jsonb, ${ACTOR}),
      (${REJECT_CAMPAIGN_ID}, ${TENANT}, 'sms', ${TEMPLATE_ID}, ${JSON.stringify(CONTACT_IDS)}::jsonb, '{}'::jsonb, ${ACTOR}),
      (${SUBMIT_CAMPAIGN_ID}, ${TENANT}, 'email', ${TEMPLATE_ID}, ${JSON.stringify(CONTACT_IDS)}::jsonb, '{}'::jsonb, ${ACTOR})
    ON CONFLICT (id) DO NOTHING
  `);
}

async function cleanup(): Promise<void> {
  await scoped(async (tx) => {
    await tx`DELETE FROM crm.pending_campaigns WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  }).catch(() => {});
}

async function campaignRow(id: string) {
  const rows = await scoped((tx) => tx<Array<{
    status: string; approvedBy: string | null; rejectedBy: string | null;
    rejectionReason: string | null; version: number;
  }>>`
    SELECT status, approved_by AS "approvedBy", rejected_by AS "rejectedBy",
           rejection_reason AS "rejectionReason", version
    FROM crm.pending_campaigns WHERE id = ${id} AND tenant_id = ${TENANT}
  `);
  return rows[0]!;
}

async function outboxEventTypes(resourceId: string): Promise<string[]> {
  const rows = await scoped((tx) => tx<Array<{ eventType: string }>>`
    SELECT event_type AS "eventType" FROM _outbox.messages
    WHERE tenant_id = ${TENANT}
      AND (payload->>'campaignId' = ${resourceId} OR payload->>'resourceId' = ${resourceId})
  `);
  return rows.map((r) => r.eventType);
}

async function auditRowCount(resourceId: string): Promise<number> {
  const rows = await scoped((tx) => tx<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM _outbox.messages
    WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
      AND payload->>'resourceId' = ${resourceId}
  `);
  return rows[0]?.n ?? 0;
}

function cmd(topic: string, payload: unknown, messageId?: string) {
  return envelope(topic, payload, { tenantId: TENANT, actorId: ACTOR, ...(messageId !== undefined ? { messageId } : {}) });
}

beforeAll(async () => {
  await cleanup();
  await seedPendingCampaigns();
  registerAllConsumers(queue);
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("TX-004: campaign approval consumer — write path, idempotency, audit", () => {
  it("approve: applies once and is idempotent on redelivery (no double-apply)", async () => {
    const { handlerFor } = captureHandlers();
    const handler = handlerFor(COMMANDS.approveCampaign);
    const first = cmd(COMMANDS.approveCampaign, {
      campaignId: APPROVE_CAMPAIGN_ID, contactIds: CONTACT_IDS, templateId: TEMPLATE_ID, channel: "email",
    });

    await runWithTenant(TENANT, () => handler(first));
    // Redeliver the identical envelope (same messageId) — must be a no-op.
    await runWithTenant(TENANT, () => handler(first));
    await runWithTenant(TENANT, () => handler(first));

    const row = await campaignRow(APPROVE_CAMPAIGN_ID);
    expect(row.status).toBe("approved");
    expect(row.approvedBy).toBe(ACTOR);
    // version=1 at seed time; exactly one UPDATE must have landed.
    expect(row.version).toBe(2);
  });

  it("approve: leaves exactly one domain event + one audit event, not one per redelivery", async () => {
    const types = await outboxEventTypes(APPROVE_CAMPAIGN_ID);
    expect(types.filter((t) => t === EVENTS.campaignApproved)).toHaveLength(1);
    expect(await auditRowCount(APPROVE_CAMPAIGN_ID)).toBe(1);
  });

  it("reject: applies once (with reason) and is idempotent on redelivery", async () => {
    const { handlerFor } = captureHandlers();
    const handler = handlerFor(COMMANDS.rejectCampaign);
    const first = cmd(COMMANDS.rejectCampaign, {
      campaignId: REJECT_CAMPAIGN_ID, reason: "Incorrect template used",
    });

    await runWithTenant(TENANT, () => handler(first));
    await runWithTenant(TENANT, () => handler(first));

    const row = await campaignRow(REJECT_CAMPAIGN_ID);
    expect(row.status).toBe("rejected");
    expect(row.rejectedBy).toBe(ACTOR);
    expect(row.rejectionReason).toBe("Incorrect template used");
    expect(row.version).toBe(2);

    const types = await outboxEventTypes(REJECT_CAMPAIGN_ID);
    expect(types.filter((t) => t === EVENTS.campaignRejected)).toHaveLength(1);
    expect(await auditRowCount(REJECT_CAMPAIGN_ID)).toBe(1);
  });

  it("a stale redelivery cannot flip an already-decided campaign back to pending semantics", async () => {
    // A late-arriving approve for a campaign already rejected must not resurrect it.
    const { handlerFor } = captureHandlers();
    const handler = handlerFor(COMMANDS.approveCampaign);
    await runWithTenant(TENANT, () => handler(cmd(COMMANDS.approveCampaign, {
      campaignId: REJECT_CAMPAIGN_ID, contactIds: CONTACT_IDS, templateId: TEMPLATE_ID, channel: "sms",
    })));
    const row = await campaignRow(REJECT_CAMPAIGN_ID);
    expect(row.status).toBe("rejected");
  });

  it("submitCampaignForApproval: is a real handler (emits domain + audit event), idempotent on redelivery", async () => {
    const { handlerFor } = captureHandlers();
    const handler = handlerFor(COMMANDS.submitCampaignForApproval);
    const first = cmd(COMMANDS.submitCampaignForApproval, { campaignId: SUBMIT_CAMPAIGN_ID });

    await runWithTenant(TENANT, () => handler(first));
    // Redeliver — must not emit a second pair of events.
    await runWithTenant(TENANT, () => handler(first));
    await runWithTenant(TENANT, () => handler(first));

    const types = await outboxEventTypes(SUBMIT_CAMPAIGN_ID);
    expect(types.filter((t) => t === EVENTS.campaignSubmittedForApproval)).toHaveLength(1);
    expect(await auditRowCount(SUBMIT_CAMPAIGN_ID)).toBe(1);

    // The pending row itself is untouched by the submit consumer (it does not
    // re-insert/overwrite — the row was already written at the route level).
    const row = await campaignRow(SUBMIT_CAMPAIGN_ID);
    expect(row.status).toBe("pending");
    expect(row.version).toBe(1);
  });
});
