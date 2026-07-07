import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";
import type { TemplateRow, TemplateClauseRow } from "./schema.js";

export async function getTemplate(id: string, tenantId: string): Promise<TemplateRow | null> {
  const row = await cache.getOrLoad<TemplateRow | undefined>(
    cache.makeKey(tenantId, "template", id),
    () => repo.findTemplateById(id, tenantId),
  );
  if (!row || row.tenantId !== tenantId) return null;
  return row;
}

export async function listTemplates(
  tenantId: string,
  opts: { limit: number; offset: number; status?: string },
): Promise<{ data: TemplateRow[]; total: number }> {
  return repo.listTemplates(tenantId, opts);
}

export async function getTemplateClauses(templateId: string, tenantId: string): Promise<TemplateClauseRow[]> {
  return repo.listTemplateClauses(templateId, tenantId);
}

export async function countTemplateClauses(templateId: string, tenantId: string): Promise<number> {
  return repo.countTemplateClauses(templateId, tenantId);
}

export async function getTemplateClause(
  templateId: string,
  clauseId: string,
  tenantId: string,
): Promise<TemplateClauseRow | null> {
  const row = await repo.findTemplateClause(templateId, clauseId, tenantId);
  return row ?? null;
}
