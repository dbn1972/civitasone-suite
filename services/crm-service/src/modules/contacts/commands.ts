import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
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
  const id = randomUUID();
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
  const msgId = randomUUID();
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
  const msgId = randomUUID();
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
  const msgId = randomUUID();
  await queue.publish(COMMANDS.mergeContacts, {
    messageId: msgId, type: COMMANDS.mergeContacts,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, tenantId: ctx.tenantId },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id: body.primaryId, status: "accepted", correlationId: ctx.correlationId };
}

export async function bulkImportContacts(ctx: RequestContext, body: BulkImportBody): Promise<Accepted> {
  const batchId = randomUUID();
  await queue.publish(COMMANDS.bulkImportContacts, {
    messageId: batchId, type: COMMANDS.bulkImportContacts,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { batchId, tenantId: ctx.tenantId, contacts: body.contacts },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id: batchId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createAccount(ctx: RequestContext, body: CreateAccountBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createAccount, {
    messageId: id, type: COMMANDS.createAccount,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, name: body.name, industry: body.industry ?? null, website: body.website || null },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export { buildView };
