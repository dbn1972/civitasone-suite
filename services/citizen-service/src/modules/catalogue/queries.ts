import * as repo from "./repo.js";

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
