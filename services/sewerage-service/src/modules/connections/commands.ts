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
  // applicationNumber is no longer generated here: it used to be a bare
  // `SEW-${Date.now()}` computed synchronously in this command handler,
  // which could collide under concurrent load (two requests in the same
  // millisecond). It is now reserved from a real Postgres sequence inside
  // the consumer's own transaction (see repo.ts's nextApplicationNumber) —
  // see migrations/0003_number_sequences.sql.
  return publishCommand(ctx, COMMANDS.connectionApply, id, { id, ...body });
}

export async function updateConnectionStatus(ctx: RequestContext, id: string, status: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.connectionUpdateStatus, id, { id, status, version });
}

export async function activateConnection(ctx: RequestContext, applicationId: string, version: number): Promise<Accepted> {
  const connectionId = randomUUID();
  // connectionNumber reserved inside the consumer's transaction (see
  // repo.ts's nextConnectionNumber) — replaces the old
  // `SEWC-${Date.now()}` scheme, same rationale as applyConnection above.
  return publishCommand(ctx, COMMANDS.connectionActivate, connectionId, { connectionId, applicationId, version });
}
