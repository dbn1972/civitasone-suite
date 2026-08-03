import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { ImportFeature } from "./repo.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function importSpatial(
  ctx: RequestContext,
  body: { dataset: string; format: "geojson" | "kml"; features: ImportFeature[]; featureCount: number },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.spatialImport, {
    messageId: id,
    type: COMMANDS.spatialImport,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
