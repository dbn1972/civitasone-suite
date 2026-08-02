import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { and, eq } from "drizzle-orm";
import { queue } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS } from "../../topics.js";
import { dmnTables, type DmnInput, type DmnOutput, type DmnRule, type DmnHitPolicy } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export type CreateDmnTableBody = {
  name: string;
  description?: string;
  hitPolicy: DmnHitPolicy;
  inputs: DmnInput[];
  outputs: DmnOutput[];
  rules: DmnRule[];
};

export type UpdateDmnTableBody = {
  version: number;
  name?: string;
  description?: string;
  hitPolicy?: DmnHitPolicy;
  inputs?: DmnInput[];
  outputs?: DmnOutput[];
  rules?: DmnRule[];
};

async function publish(ctx: RequestContext, type: string, payload: Record<string, unknown>): Promise<Accepted> {
  const id = (payload.id as string | undefined) ?? randomUUID();
  await queue.publish(type, {
    messageId: randomUUID(),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

async function existing(id: string, tenantId: string) {
  const rows = await scopedRead((tx) =>
    tx.select().from(dmnTables).where(and(eq(dmnTables.id, id), eq(dmnTables.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function createTable(ctx: RequestContext, body: CreateDmnTableBody): Promise<Accepted> {
  return publish(ctx, COMMANDS.createDmnTable, {
    id: randomUUID(),
    name: body.name,
    hitPolicy: body.hitPolicy,
    inputs: body.inputs,
    outputs: body.outputs,
    rules: body.rules,
    ...(body.description !== undefined ? { description: body.description } : {}),
  });
}

export async function updateTable(ctx: RequestContext, id: string, body: UpdateDmnTableBody): Promise<Accepted> {
  const row = await existing(id, ctx.tenantId);
  if (!row || row.status === "deleted") throw new HttpError(404, "NOT_FOUND", "DMN table not found");
  if (row.version !== body.version) {
    throw new HttpError(409, "VERSION_CONFLICT", `Version conflict: expected ${body.version}, current is ${row.version}`);
  }
  return publish(ctx, COMMANDS.updateDmnTable, {
    id,
    version: body.version,
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.hitPolicy !== undefined ? { hitPolicy: body.hitPolicy } : {}),
    ...(body.inputs !== undefined ? { inputs: body.inputs } : {}),
    ...(body.outputs !== undefined ? { outputs: body.outputs } : {}),
    ...(body.rules !== undefined ? { rules: body.rules } : {}),
  });
}

export async function deleteTable(ctx: RequestContext, id: string): Promise<Accepted> {
  const row = await existing(id, ctx.tenantId);
  if (!row || row.status === "deleted") throw new HttpError(404, "NOT_FOUND", "DMN table not found");
  return publish(ctx, COMMANDS.deleteDmnTable, { id });
}
