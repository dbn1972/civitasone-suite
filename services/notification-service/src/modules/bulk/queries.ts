import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { CampaignView, CampaignListResult, CampaignMetrics, CampaignResponseView } from "./domain.js";

export async function getCampaign(tenantId: string, id: string): Promise<CampaignView | null> {
  return cache.getOrLoad<CampaignView>(
    cache.makeKey(tenantId, RESOURCE.campaign, id),
    () => repo.findCampaignById(id),
  );
}

/** MK-001: paginated campaign list — not cached (page-window + total vary). */
export async function listCampaigns(tenantId: string, limit: number, offset: number): Promise<CampaignListResult> {
  return repo.listCampaigns(tenantId, limit, offset);
}

/** MK-004: server-computed metrics — not cached (must reflect latest responses). */
export async function getCampaignMetrics(tenantId: string, id: string): Promise<CampaignMetrics | null> {
  return repo.getCampaignMetrics(tenantId, id);
}

/** MK-004: upsert a response and invalidate the campaign cache entry. */
export async function recordResponse(
  tenantId: string,
  input: { campaignId: string; subjectType: string; subjectId: string; converted: boolean; revenueMinor: string },
  actorId: string,
): Promise<CampaignResponseView | null> {
  const result = await repo.upsertCampaignResponse(tenantId, input, actorId);
  if (result) await cache.invalidate(cache.makeKey(tenantId, RESOURCE.campaign, input.campaignId));
  return result;
}
