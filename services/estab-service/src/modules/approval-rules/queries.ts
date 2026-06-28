import * as repo from "./repo.js";
import type { ApprovalRuleRow } from "./schema.js";

export type ApprovalRuleDto = {
  id: string;
  module: string;
  sourceType: string;
  label: string;
  minAmountMinor: number;
  maxAmountMinor: number | null;
  workflowDefinitionCode: string;
  startNodeKey: string;
  steps: Array<{ role: string; label: string }>;
  priority: number;
  active: boolean;
  updatedAt: string;
};

function toDto(r: ApprovalRuleRow): ApprovalRuleDto {
  return {
    id: r.id,
    module: r.module,
    sourceType: r.sourceType,
    label: r.label,
    minAmountMinor: r.minAmountMinor,
    maxAmountMinor: r.maxAmountMinor,
    workflowDefinitionCode: r.workflowDefinitionCode,
    startNodeKey: r.startNodeKey,
    steps: Array.isArray(r.steps) ? (r.steps as Array<{ role: string; label: string }>) : [],
    priority: r.priority,
    active: r.active,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listApprovalRules(
  tenantId: string,
  filter: { sourceType?: string | undefined; module?: string | undefined },
): Promise<ApprovalRuleDto[]> {
  const rows = await repo.listRules(tenantId);
  return rows
    .filter((r) => (filter.sourceType ? r.sourceType === filter.sourceType : true))
    .filter((r) => (filter.module ? r.module === filter.module : true))
    .map(toDto);
}

export async function getApprovalRule(tenantId: string, id: string): Promise<ApprovalRuleDto | null> {
  const row = await repo.findRuleById(id, tenantId);
  return row ? toDto(row) : null;
}
