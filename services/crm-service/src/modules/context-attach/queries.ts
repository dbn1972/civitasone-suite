/**
 * G22 — Context-attach cache invalidation and read-model helpers.
 */
import { cache } from "../../shared/infra.js";

const RESOURCE_RULES = "context_attach_rules";
const RESOURCE_ATTACHMENTS = "context_attachments";

export async function invalidateRules(tenantId: string): Promise<void> {
  await cache.invalidateResource(tenantId, RESOURCE_RULES);
}

export async function invalidateAttachments(tenantId: string): Promise<void> {
  await cache.invalidateResource(tenantId, RESOURCE_ATTACHMENTS);
}
