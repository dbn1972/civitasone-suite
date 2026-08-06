import * as repo from "./repo.js";
import type { SegmentEligibilityRuleView } from "./schema.js";

export async function getRule(id: string, tenantId: string): Promise<SegmentEligibilityRuleView | null> {
  return repo.findById(id, tenantId);
}

export async function listRules(
  tenantId: string,
  limit: number,
  offset: number,
  segmentCode?: string,
  productId?: string,
): Promise<{ data: SegmentEligibilityRuleView[]; total: number }> {
  return repo.listByTenant(tenantId, limit, offset, segmentCode, productId);
}

export async function getRulesForSegment(tenantId: string, segmentCode: string): Promise<SegmentEligibilityRuleView[]> {
  return repo.listBySegment(tenantId, segmentCode);
}
