import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** GAP-ADMIN-DEVICES-04: records that an admin exported the device inventory. */
export async function recordDeviceExport(ctx: RequestContext, rowCount: number, filtered: boolean): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.deviceExportRecorded, {
    messageId: id,
    type: COMMANDS.deviceExportRecorded,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, rowCount, filtered },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** GAP2-ADMIN-DEVICES-01: records that an admin revealed the clear IP of one device. */
export async function recordDeviceIpReveal(ctx: RequestContext, deviceId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.deviceIpRevealed, {
    messageId: id,
    type: COMMANDS.deviceIpRevealed,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, deviceId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
