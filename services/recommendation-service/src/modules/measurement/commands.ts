import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { AttributionModel, Cohort } from "./schema.js";

export type { Accepted };

export async function assignExposure(
  ctx: RequestContext,
  body: {
    campaignKey: string;
    subjectId: string;
    cohort: Cohort;
    assignedAt: string;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.exposureAssign, id, { exposureId: id, ...body });
}

export async function recordAttribution(
  ctx: RequestContext,
  body: {
    campaignKey: string;
    subjectId: string;
    recommendationId: string | null;
    outcomeType: string;
    outcomeRef: string;
    productId: string | null;
    amountMinor: string;
    currency: string;
    cohort: Cohort;
    attributionModel: AttributionModel;
    occurredAt: string;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.attributionRecord, id, { attributionId: id, ...body });
}
