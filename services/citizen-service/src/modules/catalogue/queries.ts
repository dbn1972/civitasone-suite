import * as repo from "./repo.js";
import type { ServiceChannel } from "./domain.js";

export async function listDefinitions(tenantId: string) {
  return repo.listDefinitions(tenantId);
}

export async function getDefinition(tenantId: string, id: string) {
  return repo.findDefinitionById(id, tenantId);
}

/** Citizen-facing browse: latest published definitions across the catalogue. */
export async function browsePublished(tenantId: string) {
  return repo.listPublished(tenantId);
}

/** Citizen-facing detail: latest published definition for a service_key. */
export async function getPublishedByKey(tenantId: string, serviceKey: string) {
  return repo.findPublishedByKey(tenantId, serviceKey);
}

/** Latest published definition for a logical serviceId (opaque UUID). */
export async function getPublishedByServiceId(tenantId: string, serviceId: string) {
  return repo.findPublishedByServiceId(tenantId, serviceId);
}

/**
 * FN-24 — resolve the published channel allow-list for intake.
 * Accepts definition row id, logical serviceId, or serviceKey.
 * Returns null when no published definition is found (caller decides fail-open/closed).
 */
export async function getPublishedChannels(
  tenantId: string,
  opts: { serviceId?: string | undefined; serviceKey?: string | undefined },
): Promise<ServiceChannel[] | null> {
  if (opts.serviceId) {
    const byDefId = await repo.findDefinitionById(opts.serviceId, tenantId);
    if (byDefId?.status === "published") return byDefId.channels;
    const byLogical = await repo.findPublishedByServiceId(tenantId, opts.serviceId);
    if (byLogical) return byLogical.channels;
  }
  if (opts.serviceKey) {
    const byKey = await repo.findPublishedByKey(tenantId, opts.serviceKey);
    if (byKey) return byKey.channels;
  }
  return null;
}
