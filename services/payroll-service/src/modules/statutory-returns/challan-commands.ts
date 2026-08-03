import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface IngestChallanBody {
  period: string;
  bsrCode: string;
  challanSerial: string;
  depositDate: string;
  section: string;
  formType: "24Q" | "26Q";
  cin: string;
  tdsAmountMinor: string;
  totalAmountMinor: string;
  interestMinor: string;
  feeMinor: string;
}

export async function ingestChallan(ctx: RequestContext, body: IngestChallanBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.tdsChallanIngest, {
    messageId: id,
    type: COMMANDS.tdsChallanIngest,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
