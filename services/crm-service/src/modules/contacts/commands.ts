import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateContactBody, UpdateContactBody, MergeContactsBody, BulkImportBody, CreateAccountBody } from "./validators.js";
import type { ContactView } from "./schema.js";
import * as repo from "./repo.js";

export type Accepted = { id: string; status: string; correlationId: string };

function buildView(id: string, ctx: RequestContext, body: CreateContactBody, version = 1): ContactView {
  return {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    email: body.email ?? null,
    phone: body.phone ?? null,
    company: body.company ?? null,
    designation: body.designation ?? null,
    city: body.city ?? null,
    country: body.country ?? "IN",
    gstin: body.gstin ?? null,
    pan: body.pan ?? null,
    pincode: body.pincode ?? null,
    temperature: null,
    priority: null,
    segment: null,
    product: null,
    region: null,
    expectedValueMinor: null,
    leadStatus: body.leadStatus ?? "new",
    leadSource: body.leadSource ?? null,
    ownerId: body.ownerId ?? ctx.actorId,
    accountId: body.accountId ?? null,
    tags: body.tags ?? [],
    marketingConsent: body.marketingConsent ?? false,
    consentDate: body.marketingConsent ? new Date().toISOString().slice(0, 10) : null,
    lastActivityAt: null,
    status: "active",
    version,
  };
}

export async function createContact(ctx: RequestContext, body: CreateContactBody): Promise<Accepted> {
  const id = commandId(ctx, COMMANDS.createContact);
  const projected = buildView(id, ctx, body);
  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.createContact, {
    messageId: id, type: COMMANDS.createContact,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: projected,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateContact(ctx: RequestContext, id: string, body: UpdateContactBody): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.updateContact}:${id}`);
  await queue.publish(COMMANDS.updateContact, {
    messageId: msgId, type: COMMANDS.updateContact,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteContact(ctx: RequestContext, id: string): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.deleteContact}:${id}`);
  await queue.publish(COMMANDS.deleteContact, {
    messageId: msgId, type: COMMANDS.deleteContact,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function mergeContacts(ctx: RequestContext, body: MergeContactsBody): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.mergeContacts}:${body.primaryId}`);
  await queue.publish(COMMANDS.mergeContacts, {
    messageId: msgId, type: COMMANDS.mergeContacts,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, tenantId: ctx.tenantId },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id: body.primaryId, status: "accepted", correlationId: ctx.correlationId };
}

export async function bulkImportContacts(ctx: RequestContext, body: BulkImportBody): Promise<Accepted> {
  const batchId = commandId(ctx, COMMANDS.bulkImportContacts);
  await queue.publish(COMMANDS.bulkImportContacts, {
    messageId: batchId, type: COMMANDS.bulkImportContacts,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { batchId, tenantId: ctx.tenantId, contacts: body.contacts },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id: batchId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Emit a dedicated audit event for a bulk PII export (DPDP accountability).
 * Read paths have no transaction, so publish the audit record directly.
 */
export async function auditBulkExport(ctx: RequestContext, count: number, admin: boolean): Promise<void> {
  await queue.publish("audit.event.record", {
    messageId: randomUUID(), type: "audit.event.record",
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      service: "crm", action: "contacts_bulk_export", resourceType: "contact",
      resourceId: ctx.tenantId, outcome: "success",
      metadata: { recordCount: count, masked: !admin },
    },
  });
}

export async function createAccount(ctx: RequestContext, body: CreateAccountBody): Promise<Accepted> {
  const id = commandId(ctx, COMMANDS.createAccount);
  await queue.publish(COMMANDS.createAccount, {
    messageId: id, type: COMMANDS.createAccount,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, name: body.name, industry: body.industry ?? null, website: body.website || null, gstin: body.gstin ?? null, pan: body.pan ?? null },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export type ClassificationPatch = {
  temperature?: string | null | undefined;
  priority?: string | null | undefined;
  segment?: string | null | undefined;
  product?: string | null | undefined;
  region?: string | null | undefined;
  expectedValueMinor?: number | null | undefined;
};

/**
 * LQ-003: set lead classification fields (async CQRS like every other contact
 * mutation). The route validates + publishes; classification-consumer persists and
 * audits. Idempotency key is scoped per contact so a reused client key across two
 * contacts does not collapse into one write.
 */
export async function classifyContact(
  ctx: RequestContext,
  id: string,
  patch: ClassificationPatch,
): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.classifyContact}:${id}`);
  await queue.publish(COMMANDS.classifyContact, {
    messageId: msgId, type: COMMANDS.classifyContact,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...patch },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export { buildView };
