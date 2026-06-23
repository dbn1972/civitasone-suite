import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { buildView } from "./commands.js";
import type { ContactView } from "./schema.js";
import type { CreateContactBody } from "./validators.js";
import type { RequestContext } from "@civitasone/types";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerContactConsumers(queue: Queue): void {
  queue.subscribe<ContactView>(COMMANDS.createContact, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name,
        email: p.email, phone: p.phone, company: p.company,
        designation: p.designation, city: p.city, country: p.country ?? "IN",
        leadStatus: p.leadStatus, leadSource: p.leadSource,
        ownerId: p.ownerId, accountId: p.accountId,
        tags: p.tags, marketingConsent: p.marketingConsent,
        consentDate: p.consentDate, lastActivityAt: p.lastActivityAt ? new Date(p.lastActivityAt) : null,
        status: p.status, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
      });
      await emit(tx, msg, EVENTS.contactCreated, { contactId: p.id, name: p.name }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.updateContact, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string } & Partial<ContactView>;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const patch: Parameters<typeof repo.update>[3] = {};
      if (p.name !== undefined) patch.name = p.name;
      if (p.email !== undefined) patch.email = p.email;
      if (p.phone !== undefined) patch.phone = p.phone;
      if (p.company !== undefined) patch.company = p.company;
      if (p.designation !== undefined) patch.designation = p.designation;
      if (p.city !== undefined) patch.city = p.city;
      if (p.country !== undefined) patch.country = p.country;
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
    });
    await cache.invalidate(keyFor(msg.tenantId, p.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
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
  });

  queue.subscribe(COMMANDS.mergeContacts, async (msg) => {
    const p = msg.payload as { primaryId: string; duplicateId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.reassignDeals(tx, p.duplicateId, p.primaryId, p.tenantId);
      await repo.reassignActivities(tx, p.duplicateId, p.primaryId, p.tenantId);
      await repo.softDelete(tx, p.duplicateId, p.tenantId, msg.actorId);
      await emit(tx, msg, EVENTS.contactUpdated, { contactId: p.primaryId, mergedFrom: p.duplicateId }, "merge", p.primaryId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.bulkImportContacts, async (msg) => {
    const p = msg.payload as { batchId: string; tenantId: string; contacts: CreateContactBody[] };
    const ctx = { tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as RequestContext;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rows = p.contacts.map((c) => {
        const id = randomUUID();
        const view = buildView(id, ctx, c);
        return {
          id, tenantId: p.tenantId, name: view.name,
          email: view.email, phone: view.phone, company: view.company,
          designation: view.designation, city: view.city, country: view.country,
          leadStatus: view.leadStatus, leadSource: view.leadSource,
          ownerId: view.ownerId, accountId: view.accountId,
          tags: view.tags, marketingConsent: view.marketingConsent,
          consentDate: view.consentDate, lastActivityAt: null,
          status: "active", createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
        };
      });
      await repo.bulkInsert(tx, rows);
      await emit(tx, msg, EVENTS.contactCreated, { batchId: p.batchId, count: rows.length }, "bulk_import", p.batchId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.createAccount, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; industry: string | null; website: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAccount(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name,
        industry: p.industry, website: p.website,
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
