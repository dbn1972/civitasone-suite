import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateGradeBandBody, UpdateGradeBandBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** Money travels the queue as digit strings (bigint is not JSON-serialisable). */
export interface GradeBandPayload {
  id: string;
  code?: string; name?: string; rank?: number; track?: string | null;
  ctcMinMinor?: string | null; ctcMaxMinor?: string | null; noticeDays?: number | null;
}
const s = (v: bigint | null | undefined): string | null | undefined => (v === undefined ? undefined : v === null ? null : v.toString());

async function publish(ctx: RequestContext, topic: string, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(topic, {
    messageId: randomUUID(), type: topic,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createGradeBand(ctx: RequestContext, body: CreateGradeBandBody): Promise<Accepted> {
  const id = randomUUID();
  return publish(ctx, COMMANDS.gradeBandCreate, id, {
    id, code: body.code, name: body.name, rank: body.rank, track: body.track ?? null,
    ctcMinMinor: s(body.ctcMinMinor) ?? null, ctcMaxMinor: s(body.ctcMaxMinor) ?? null, noticeDays: body.noticeDays ?? null,
  } satisfies GradeBandPayload);
}

export async function updateGradeBand(ctx: RequestContext, id: string, body: UpdateGradeBandBody): Promise<Accepted> {
  const { expectedVersion: _v, ...c } = body;
  const changes: Record<string, unknown> = {};
  if (c.name !== undefined) changes.name = c.name;
  if (c.rank !== undefined) changes.rank = c.rank;
  if (c.track !== undefined) changes.track = c.track;
  if (c.noticeDays !== undefined) changes.noticeDays = c.noticeDays;
  if (c.ctcMinMinor !== undefined) changes.ctcMinMinor = s(c.ctcMinMinor);
  if (c.ctcMaxMinor !== undefined) changes.ctcMaxMinor = s(c.ctcMaxMinor);
  return publish(ctx, COMMANDS.gradeBandUpdate, id, { id, changes });
}

export async function setGradeBandActive(ctx: RequestContext, id: string, isActive: boolean): Promise<Accepted> {
  return publish(ctx, COMMANDS.gradeBandSetActive, id, { id, isActive });
}

export async function deleteGradeBand(ctx: RequestContext, id: string): Promise<Accepted> {
  return publish(ctx, COMMANDS.gradeBandDelete, id, { id });
}
