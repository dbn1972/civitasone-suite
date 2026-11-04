/**
 * POLICY-SEED-1 (UAT bundle 17): tenant.tenant.created -> the standard roles and approve grants for the new tenant.
 *
 * Before this policy-service had no tenant.created consumer: the standard grants were applied by a dev seed script
 * to two hard-coded tenants only, so every newer tenant had no hrms.leave / payroll.run / procurement.* approve
 * grant and its non-super_admin approvers got 403 completing workflow tasks.
 *  - The envelope tenantId must be the new tenant (what tenant-service sends); otherwise NonRetryable.
 *  - Contract: tenant.tenant.created v1.1 (@civitasone/events/contracts tenantTenantCreated). Only the tenant id is
 *    read (a v1.0 { tenantId, plan } event works too). A contract violation is NonRetryable (straight to the DLQ).
 *  - Dedupe BEFORE side effects: an already-processed delivery is acked at once; the inbox mark and every write share
 *    one transaction.
 *  - The writes run under runWithTenant(<the new tenant>) (roles.* are FORCE RLS), not the envelope tenant, the
 *    same way the admin-service F133 consumer does.
 *  - Idempotent: existing roles / grants are skipped (standard-provision.ts).
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { tenantTenantCreated, type TenantCreatedEvent } from "@civitasone/events/contracts";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, processed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, RESOURCE } from "../../topics.js";
import { provisionStandardGrantsForTenant } from "../roles/standard-provision.js";

const log = pino({ name: "policy:tenant-provision" });
const AUDIT_TOPIC = "audit.event.record";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The new tenant id of a tenant.tenant.created payload; NonRetryable when the payload breaks the contract. */
export function newTenantIdOf(payload: unknown): string {
  const check = tenantTenantCreated.validate(payload);
  if (!check.ok) {
    const fields = check.violation?.issues.map((i) => i.path).join(", ") ?? "payload";
    throw new NonRetryableError(`tenant.tenant.created violates the contract (${fields})`);
  }
  const p = payload as TenantCreatedEvent;
  if (p.id && p.id !== p.tenantId) throw new NonRetryableError("tenant.tenant.created: id and tenantId name different tenants");
  if (!UUID_RE.test(p.tenantId)) throw new NonRetryableError("tenant.tenant.created: tenantId is not a uuid");
  return p.tenantId;
}

async function alreadyProcessed(messageId: string): Promise<boolean> {
  const rows = await db.select({ id: processed.messageId }).from(processed).where(eq(processed.messageId, messageId)).limit(1);
  return rows.length > 0;
}

export function registerTenantProvisionConsumers(queue: Queue): void {
  queue.subscribe<TenantCreatedEvent>(CONSUMED_EVENTS.tenantCreated, async (msg: CommandEnvelope<TenantCreatedEvent>) => {
    if (await alreadyProcessed(msg.messageId)) return;
    const tenantId = newTenantIdOf(msg.payload);
    // Review (defence in depth): tenant-service sends the event in the new tenant's own envelope (tenantId ==
    // payload tenantId). Anything else -- a forged or replayed event naming another tenant -- is dead-lettered.
    if (msg.tenantId !== tenantId) {
      throw new NonRetryableError(`tenant.tenant.created: envelope tenant ${msg.tenantId} is not the new tenant ${tenantId}`);
    }
    const result = await runWithTenant(tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return null;
      const r = await provisionStandardGrantsForTenant(tx, tenantId, msg.actorId);
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "policy", action: "provision_standard_grants", resourceType: RESOURCE.role, resourceId: tenantId, outcome: "success",
          rolesCreated: r.rolesCreated.length, grantsCreated: r.grantsCreated.length,
        },
      });
      return r;
    }));
    if (result) {
      await cache.invalidate(cache.makeKey(tenantId, `${RESOURCE.role}_list`, tenantId));
      log.info({ tenantId, rolesCreated: result.rolesCreated.length, grantsCreated: result.grantsCreated.length }, "standard grants provisioned for new tenant");
    }
  });
}
