import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import { allocateLeadNo } from "../../shared/numbering.js";
import * as repo from "./repo.js";
import { invalidateDashboard } from "../dashboard/queries.js";
import { buildView } from "./commands.js";
import type { ContactView } from "./schema.js";
import type { CreateContactBody } from "./validators.js";
import type { RequestContext } from "@civitasone/types";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerContactConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe<ContactView>(COMMANDS.createContact, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      // P0-1 cross-tenant FK guard: a referenced account must live in this tenant.
      if (p.accountId && !(await repo.accountExists(p.tenantId, p.accountId))) {
        await emitAudit(tx, msg, "create", p.id, "rejected_cross_tenant_account");
        return;
      }
      // LM-006: allocate gapless lead reference number inside the same transaction.
      const leadNo = await allocateLeadNo(tx, p.tenantId);
      await repo.insert(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name,
        email: p.email, phone: p.phone, company: p.company,
        designation: p.designation, city: p.city, country: p.country ?? "IN",
        gstin: p.gstin, pan: p.pan, pincode: p.pincode,
        leadStatus: p.leadStatus, leadSource: p.leadSource,
        ownerId: p.ownerId, accountId: p.accountId,
        tags: p.tags, marketingConsent: p.marketingConsent,
        consentDate: p.consentDate, lastActivityAt: p.lastActivityAt ? new Date(p.lastActivityAt) : null,
        status: p.status, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
        leadNo,
      });
      await emit(tx, msg, EVENTS.contactCreated, { contactId: p.id, name: p.name, leadNo }, "create", p.id);
      await emit(tx, msg, EVENTS.leadCreated, { contactId: p.id, name: p.name, leadSource: p.leadSource, leadStatus: p.leadStatus, leadNo }, "lead_create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    await invalidateDashboard(msg.tenantId);
  });

  queue.subscribe(COMMANDS.updateContact, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string } & Partial<ContactView>;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // P0-1 cross-tenant FK guard: a (re)assigned account must live in this tenant.
      if (p.accountId && !(await repo.accountExists(p.tenantId, p.accountId))) {
        await emitAudit(tx, msg, "update", p.id, "rejected_cross_tenant_account");
        return;
      }
      const patch: Parameters<typeof repo.update>[3] = {};
      if (p.name !== undefined) patch.name = p.name;
      if (p.email !== undefined) patch.email = p.email;
      if (p.phone !== undefined) patch.phone = p.phone;
      if (p.company !== undefined) patch.company = p.company;
      if (p.designation !== undefined) patch.designation = p.designation;
      if (p.city !== undefined) patch.city = p.city;
      if (p.country !== undefined) patch.country = p.country;
      if (p.gstin !== undefined) patch.gstin = p.gstin;
      if (p.pan !== undefined) patch.pan = p.pan;
      if (p.pincode !== undefined) patch.pincode = p.pincode;
      if (p.leadStatus !== undefined) patch.leadStatus = p.leadStatus;
      if (p.leadSource !== undefined) patch.leadSource = p.leadSource;
      if (p.ownerId !== undefined) patch.ownerId = p.ownerId;
      if (p.accountId !== undefined) patch.accountId = p.accountId;
      if (p.tags !== undefined) patch.tags = p.tags;
      if (p.marketingConsent !== undefined) {
        patch.marketingConsent = p.marketingConsent;
        if (p.marketingConsent) patch.consentDate = new Date().toISOString().slice(0, 10);
      }
      if (p.status !== undefined) patch.status = p.status;
      await repo.update(tx, p.id, p.tenantId, patch, msg.actorId);
      await emit(tx, msg, EVENTS.contactUpdated, { contactId: p.id }, "update", p.id);
      await emit(tx, msg, EVENTS.leadUpdated, { contactId: p.id, changedFields: Object.keys(patch) }, "lead_update", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    await invalidateDashboard(msg.tenantId);
  });

  queue.subscribe(COMMANDS.deleteContact, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.softDelete(tx, p.id, p.tenantId, msg.actorId);
      await emit(tx, msg, EVENTS.contactDeleted, { contactId: p.id }, "delete", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    // Closes the known stale-count gap: a soft-deleted contact must drop out of
    // the cached dashboard summary immediately, not after the TTL.
    await invalidateDashboard(msg.tenantId);
  });

  queue.subscribe(COMMANDS.mergeContacts, async (msg) => {
    const p = msg.payload as { primaryId: string; duplicateId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      if (p.primaryId === p.duplicateId) {
        await emitAudit(tx, msg, "merge", p.primaryId, "rejected_same_id");
        return;
      }
      // Both contacts must exist, be active, and belong to the caller's tenant.
      const primary = await repo.findActiveRow(p.primaryId, p.tenantId);
      const duplicate = await repo.findActiveRow(p.duplicateId, p.tenantId);
      if (!primary || !duplicate) {
        await emitAudit(tx, msg, "merge", p.primaryId, "rejected_not_found_or_cross_tenant");
        return;
      }

      // Field merge: carry non-null fields from the duplicate onto the primary
      // ONLY where the primary is currently null (never overwrite primary data).
      const patch: Parameters<typeof repo.update>[3] = {};
      const carry = [
        "email", "phone", "company", "designation", "city", "country",
        "leadSource", "ownerId", "accountId",
      ] as const;
      for (const f of carry) {
        if ((primary[f] === null || primary[f] === undefined) && duplicate[f] != null) {
          (patch as Record<string, unknown>)[f] = duplicate[f];
        }
      }
      // Union tags.
      const pTags = (primary.tags as string[]) ?? [];
      const dTags = (duplicate.tags as string[]) ?? [];
      const mergedTags = Array.from(new Set([...pTags, ...dTags]));
      if (mergedTags.length !== pTags.length) patch.tags = mergedTags;
      // Preserve consent: if either granted, keep granted with the duplicate's date.
      if (duplicate.marketingConsent && !primary.marketingConsent) {
        patch.marketingConsent = true;
        if (duplicate.consentDate) patch.consentDate = duplicate.consentDate;
      }

      if (Object.keys(patch).length > 0) {
        await repo.update(tx, p.primaryId, p.tenantId, patch, msg.actorId);
      }
      await repo.reassignDeals(tx, p.duplicateId, p.primaryId, p.tenantId);
      await repo.reassignActivities(tx, p.duplicateId, p.primaryId, p.tenantId);
      await repo.softDelete(tx, p.duplicateId, p.tenantId, msg.actorId);
      await emit(tx, msg, EVENTS.contactUpdated, { contactId: p.primaryId, mergedFrom: p.duplicateId }, "merge", p.primaryId);
    });
    await cache.invalidate(keyFor(msg.tenantId, p.primaryId));
    await cache.invalidate(keyFor(msg.tenantId, p.duplicateId));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    await invalidateDashboard(msg.tenantId);
  });

  queue.subscribe(COMMANDS.bulkImportContacts, async (msg) => {
    const p = msg.payload as { batchId: string; tenantId: string; contacts: CreateContactBody[] };
    const ctx = { tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as RequestContext;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      let inserted = 0;
      let skipped = 0;
      let errored = 0;
      const skippedRows: Array<{ index: number; email: string | null; reason: string }> = [];
      // Per-row so one duplicate email (unique tenant,email_idx) skips that row
      // only, instead of aborting the whole batch. A savepoint isolates each
      // row's failure from the surrounding transaction.
      for (let i = 0; i < p.contacts.length; i++) {
        const c = p.contacts[i]!;
        const id = randomUUID();
        const view = buildView(id, ctx, c);
        // LM-006: allocate inside the per-row savepoint so a failed row does not
        // consume a number. Each successful insert gets its own gapless lead_no.
        const row = {
          id, tenantId: p.tenantId, name: view.name,
          email: view.email, phone: view.phone, company: view.company,
          designation: view.designation, city: view.city, country: view.country,
          gstin: view.gstin, pan: view.pan, pincode: view.pincode,
          leadStatus: view.leadStatus, leadSource: view.leadSource,
          ownerId: view.ownerId, accountId: view.accountId,
          tags: view.tags, marketingConsent: view.marketingConsent,
          consentDate: view.consentDate, lastActivityAt: null,
          status: "active", createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
          leadNo: undefined as string | undefined,
        };
        try {
          // Savepoint per row so an unexpected error rolls back only this row,
          // not the whole batch. onConflictDoNothing handles the dup case
          // without raising, so the common path needs no rollback.
          const outcome = await tx.transaction(async (sp) => {
            const leadNo = await allocateLeadNo(sp, p.tenantId);
            row.leadNo = leadNo;
            return repo.bulkInsertRow(sp, { ...row, leadNo });
          });
          if (outcome === "inserted") inserted++;
          else {
            skipped++;
            skippedRows.push({ index: i, email: view.email, reason: "duplicate_email" });
          }
        } catch (err) {
          errored++;
          skippedRows.push({ index: i, email: view.email, reason: "error" });
          (msg as { log?: { warn?: (o: unknown, m: string) => void } }).log?.warn?.(
            { err, index: i }, "bulk import row failed",
          );
        }
      }
      await emit(
        tx, msg, EVENTS.contactCreated,
        { batchId: p.batchId, total: p.contacts.length, inserted, skipped, errored, skippedRows },
        "bulk_import", p.batchId,
      );
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    await invalidateDashboard(msg.tenantId);
  });

  queue.subscribe(COMMANDS.createAccount, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; industry: string | null; website: string | null; gstin: string | null; pan: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAccount(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name,
        industry: p.industry, website: p.website,
        gstin: p.gstin, pan: p.pan,
        status: "active", createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      await emit(tx, msg, EVENTS.accountCreated, { accountId: p.id, name: p.name }, "create_account", p.id);
    });
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
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
    payload: { service: "crm", action, resourceType: "contact", resourceId, outcome: "success" },
  });
}

/** Audit-only emit (no domain event) — used for rejected/validation outcomes. */
async function emitAudit(
  tx: unknown,
  msg: CommandEnvelope,
  action: string,
  resourceId: string,
  outcome: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "crm", action, resourceType: "contact", resourceId, outcome },
  });
}
