import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { CampaignView } from "./domain.js";

export async function getCampaign(tenantId: string, id: string): Promise<CampaignView | null> {
  return cache.getOrLoad<CampaignView>(
    cache.makeKey(tenantId, RESOURCE.campaign, id),
    () => repo.findCampaignById(id),
  );
}
