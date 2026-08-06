/**
 * G7 read models. Every read is served through `cache.getOrLoad` / `cache.listOrLoad`
 * (read-through Redis, DB on miss), and every write path invalidates both the entity
 * key and the resource's cached list variants.
 */
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { ChecklistInstanceView, ChecklistTemplateView } from "./schema.js";

export const TEMPLATE_RESOURCE = "checklist_template";
export const INSTANCE_RESOURCE = "checklist_instance";

export function templateKeyFor(tenantId: string, id: string): string {
  return cache.makeKey(tenantId, TEMPLATE_RESOURCE, id);
}

export function instanceKeyFor(tenantId: string, id: string): string {
  return cache.makeKey(tenantId, INSTANCE_RESOURCE, id);
}

export function getTemplate(id: string, tenantId: string): Promise<ChecklistTemplateView | null> {
  return cache.getOrLoad<ChecklistTemplateView>(templateKeyFor(tenantId, id), () =>
    repo.findTemplateById(id, tenantId),
  );
}

export function listTemplates(
  tenantId: string,
  limit: number,
  offset: number,
  filters: repo.TemplateFilters = {},
): Promise<{ rows: ChecklistTemplateView[]; total: number }> {
  const variant = `${limit}:${offset}:${filters.templateKey ?? "*"}:${filters.status ?? "*"}`;
  return cache.listOrLoad(tenantId, TEMPLATE_RESOURCE, variant, () =>
    repo.listTemplates(tenantId, limit, offset, filters),
  );
}

export function getInstance(id: string, tenantId: string): Promise<ChecklistInstanceView | null> {
  return cache.getOrLoad<ChecklistInstanceView>(instanceKeyFor(tenantId, id), () =>
    repo.findInstanceById(id, tenantId),
  );
}

export function listInstances(
  tenantId: string,
  limit: number,
  offset: number,
  filters: repo.InstanceFilters = {},
): Promise<{ rows: ChecklistInstanceView[]; total: number }> {
  const variant = [
    limit,
    offset,
    filters.subjectType ?? "*",
    filters.subjectId ?? "*",
    filters.status ?? "*",
    filters.templateKey ?? "*",
  ].join(":");
  return cache.listOrLoad(tenantId, INSTANCE_RESOURCE, variant, () =>
    repo.listInstances(tenantId, limit, offset, filters),
  );
}

/** Drop the template entity key and every cached template list variant. */
export async function invalidateTemplate(tenantId: string, id: string): Promise<void> {
  await cache.invalidate(templateKeyFor(tenantId, id));
  await cache.invalidateResource(tenantId, TEMPLATE_RESOURCE);
}

/** Drop the instance entity key and every cached instance list variant. */
export async function invalidateInstance(tenantId: string, id: string): Promise<void> {
  await cache.invalidate(instanceKeyFor(tenantId, id));
  await cache.invalidateResource(tenantId, INSTANCE_RESOURCE);
}
