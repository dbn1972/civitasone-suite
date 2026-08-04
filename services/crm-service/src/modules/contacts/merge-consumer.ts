/**
 * Merge consumers for leads (= contacts) and accounts (DQ-002).
 *
 * Mirrors the existing mergeContacts consumer: validate both ids are same-tenant
 * and active (reject cross-tenant + same-id via an audit-only emit), field-merge
 * non-null values duplicate -> primary WITHOUT overwriting primary data, reassign
 * every child to the primary, soft-delete the duplicate, and emit a *Merged event
 * carrying `mergedFrom` plus a full audit trace.
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import * as mergeRepo from "./merge-repo.js";
import { invalidateDashboard } from "../dashboard/queries.js";
import type { ContactRow } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

interface MergePayload {
  primaryId: string;
  duplicateId: string;
  tenantId: string;
}

export function registerMergeConsumers(queue: Queue): void {
  // ── Lead merge (a lead is a contact with lead_status) ──────────────────────
  queue.subscribe(COMMANDS.mergeLeads, async (msg) => {
    const p = msg.payload as MergePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      if (p.primaryId === p.duplicateId) {
        await emitAudit(tx, msg, "merge", "lead", p.primaryId, "rejected_same_id");
        return;
      }
      const primary = await repo.findActiveRow(p.primaryId, p.tenantId);
      const duplicate = await repo.findActiveRow(p.duplicateId, p.tenantId);
      if (!primary || !duplicate) {
        await emitAudit(tx, msg, "merge", "lead", p.primaryId, "rejected_not_found_or_cross_tenant");
        return;
      }

      const patch = buildContactMergePatch(primary, duplicate);
      if (Object.keys(patch).length > 0) {
        await repo.update(tx, p.primaryId, p.tenantId, patch, msg.actorId);
      }
      await mergeRepo.reassignContactChildren(tx, p.duplicateId, p.primaryId, p.tenantId);
      await repo.softDelete(tx, p.duplicateId, p.tenantId, msg.actorId);

      await emit(
        tx, msg, EVENTS.leadMerged,
        { leadId: p.primaryId, mergedFrom: p.duplicateId },
        "merge", "lead", p.primaryId,
      );
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.primaryId));
    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.duplicateId));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    await invalidateDashboard(msg.tenantId);
  });

  // ── Account merge ──────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.mergeAccounts, async (msg) => {
    const p = msg.payload as MergePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      if (p.primaryId === p.duplicateId) {
        await emitAudit(tx, msg, "merge", "account", p.primaryId, "rejected_same_id");
        return;
      }
      const primary = await mergeRepo.findActiveAccountRow(p.primaryId, p.tenantId);
      const duplicate = await mergeRepo.findActiveAccountRow(p.duplicateId, p.tenantId);
      if (!primary || !duplicate) {
        await emitAudit(tx, msg, "merge", "account", p.primaryId, "rejected_not_found_or_cross_tenant");
        return;
      }

      const patch: Parameters<typeof mergeRepo.mergeUpdateAccount>[3] = {};
      const carry = ["industry", "website", "gstin", "pan"] as const;
      for (const f of carry) {
        if ((primary[f] === null || primary[f] === undefined) && duplicate[f] != null) {
          patch[f] = duplicate[f] as string;
        }
      }
      // Only adopt the duplicate's parent if the primary has none, and never
      // point an account at itself.
      if (!primary.parentId && duplicate.parentId && duplicate.parentId !== p.primaryId) {
        patch.parentId = duplicate.parentId;
      }
      await mergeRepo.mergeUpdateAccount(tx, p.primaryId, p.tenantId, patch, msg.actorId);
      await mergeRepo.reassignAccountChildren(tx, p.duplicateId, p.primaryId, p.tenantId);
      await mergeRepo.softDeleteAccount(tx, p.duplicateId, p.tenantId, msg.actorId);

      await emit(
        tx, msg, EVENTS.accountMerged,
        { accountId: p.primaryId, mergedFrom: p.duplicateId },
        "merge", "account", p.primaryId,
      );
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    await invalidateDashboard(msg.tenantId);
  });
}

/**
 * Carry the duplicate's non-null contact fields onto the primary ONLY where the
 * primary is currently empty (never overwrite primary data). Unions tags and
 * preserves marketing consent.
 */
function buildContactMergePatch(
  primary: ContactRow,
  duplicate: ContactRow,
): Parameters<typeof repo.update>[3] {
  const patch: Parameters<typeof repo.update>[3] = {};
  const carry = [
    "email", "phone", "company", "designation", "city", "country",
    "leadSource", "ownerId", "accountId", "gstin", "pan", "pincode",
  ] as const;
  for (const f of carry) {
    if ((primary[f] === null || primary[f] === undefined) && duplicate[f] != null) {
      (patch as Record<string, unknown>)[f] = duplicate[f];
    }
  }
  // Keep the higher lead score.
  if (duplicate.score != null && (primary.score == null || duplicate.score > primary.score)) {
    patch.score = duplicate.score;
  }
  const pTags = (primary.tags as string[]) ?? [];
  const dTags = (duplicate.tags as string[]) ?? [];
  const mergedTags = Array.from(new Set([...pTags, ...dTags]));
  if (mergedTags.length !== pTags.length) patch.tags = mergedTags;
  if (duplicate.marketingConsent && !primary.marketingConsent) {
    patch.marketingConsent = true;
    if (duplicate.consentDate) patch.consentDate = duplicate.consentDate;
  }
  return patch;
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType, resourceId, outcome: "success" },
  });
}

async function emitAudit(
  tx: unknown,
  msg: CommandEnvelope,
  action: string,
  resourceType: string,
  resourceId: string,
  outcome: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType, resourceId, outcome },
  });
}
