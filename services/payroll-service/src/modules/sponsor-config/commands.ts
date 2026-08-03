import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface UpsertSponsorBody {
  sponsorCode: string;
  sponsorIfsc: string;
  sponsorAccount: string;
  utilityCode?: string | null;
  userNumber?: string | null;
  settlementOffsetDays: number;
  nachEnabled: boolean;
  apbsEnabled: boolean;
  maxRecordsPerFile: number;
  maxAmountPerFileMinor: string;
}

export async function upsertSponsorConfig(ctx: RequestContext, body: UpsertSponsorBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.sponsorConfigUpsert, {
    messageId: id,
    type: COMMANDS.sponsorConfigUpsert,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
