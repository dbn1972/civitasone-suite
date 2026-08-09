import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface ApplyInput {
  propertyRef: string | null;
  waterConnectionRef: string | null;
  connectionClass: string;
  siteDetails: Record<string, unknown> | null;
}

export async function applyConnection(ctx: RequestContext, body: ApplyInput): Promise<Accepted> {
  const id = randomUUID();
  const applicationNumber = `SEW-${Date.now()}`;
  return publishCommand(ctx, COMMANDS.connectionApply, id, { id, applicationNumber, ...body });
}

export async function updateConnectionStatus(ctx: RequestContext, id: string, status: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.connectionUpdateStatus, id, { id, status, version });
}

export async function activateConnection(ctx: RequestContext, applicationId: string, version: number): Promise<Accepted> {
  const connectionId = randomUUID();
  const connectionNumber = `SEWC-${Date.now()}`;
  return publishCommand(ctx, COMMANDS.connectionActivate, connectionId, { connectionId, connectionNumber, applicationId, version });
}
