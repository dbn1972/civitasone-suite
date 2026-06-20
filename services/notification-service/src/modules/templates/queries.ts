import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { TemplateView, PrefView } from "./domain.js";

export async function getTemplate(tenantId: string, id: string): Promise<TemplateView | null> {
  return cache.getOrLoad<TemplateView>(cache.makeKey(tenantId, RESOURCE.template, id), () => repo.findTemplateById(id));
}

export async function listTemplates(tenantId: string): Promise<TemplateView[]> {
  return cache.getOrLoad<TemplateView[]>(
    cache.makeKey(tenantId, `${RESOURCE.template}_list`, tenantId),
    () => repo.findTemplatesByTenant(tenantId)
  ) as Promise<TemplateView[]>;
}

export async function getUserPrefs(tenantId: string, userId: string): Promise<PrefView[]> {
  return cache.getOrLoad<PrefView[]>(
    cache.makeKey(tenantId, RESOURCE.prefs, userId),
    () => repo.findPrefsByUser(userId)
  ) as Promise<PrefView[]>;
}

export async function listTemplateVersions(tenantId: string, id: string): Promise<TemplateView[]> {
  return cache.getOrLoad<TemplateView[]>(
    cache.makeKey(tenantId, `${RESOURCE.template}_versions`, id),
    () => repo.findTemplateVersions(id),
  ) as Promise<TemplateView[]>;
}
