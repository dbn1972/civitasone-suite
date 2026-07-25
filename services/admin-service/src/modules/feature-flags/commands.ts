/**
 * Feature flag command handlers (WRITE PATH).
 * Route → validate → publish command to SQS → return 202.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface FlagCreatePayload {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  targetSegments: string[];
  owner?: string | undefined;
  expiresAt?: string | null | undefined;
}

export interface FlagUpdatePayload {
  name?: string;
  description?: string;
  enabled?: boolean;
  rolloutPercent?: number;
  targetSegments?: string[];
  owner?: string | undefined;
  expiresAt?: string | null | undefined;
}

export async function flagCreate(ctx: RequestContext, payload: FlagCreatePayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.featureFlagManageCreate, {
    messageId: id,
    type: COMMANDS.featureFlagManageCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function flagUpdate(ctx: RequestContext, flagId: string, payload: FlagUpdatePayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish("admin.feature_flag.update", {
    messageId: id,
    type: "admin.feature_flag.update",
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { flagId, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function flagKill(ctx: RequestContext, flagId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish("admin.feature_flag.kill", {
    messageId: id,
    type: "admin.feature_flag.kill",
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { flagId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function flagDelete(ctx: RequestContext, flagId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish("admin.feature_flag.delete", {
    messageId: id,
    type: "admin.feature_flag.delete",
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { flagId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
