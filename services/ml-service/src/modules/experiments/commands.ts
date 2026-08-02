import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { and, eq } from "drizzle-orm";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { mlModels } from "../models/schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

const VALID_DOMAINS = ["leads", "tickets", "inventory", "subscriptions", "tasks", "transactions"] as const;
export type ExperimentDomain = (typeof VALID_DOMAINS)[number];

export interface CreateExperimentBody {
  domain: ExperimentDomain;
  name: string;
  challengerModelId: string;
  currentModelId: string;
  splitPct: number;
}

export interface EndExperimentBody {
  status: "completed" | "cancelled";
}

export async function experimentCreate(
  ctx: RequestContext,
  body: CreateExperimentBody,
): Promise<Accepted> {
  await db.transaction(async (tx) => {
    const [challenger] = await tx
      .select()
      .from(mlModels)
      .where(and(eq(mlModels.id, body.challengerModelId), eq(mlModels.tenantId, ctx.tenantId)))
      .limit(1);

    if (!challenger) {
      throw new HttpError(404, "NOT_FOUND", "challenger model not found");
    }

    const [current] = await tx
      .select()
      .from(mlModels)
      .where(and(eq(mlModels.id, body.currentModelId), eq(mlModels.tenantId, ctx.tenantId)))
      .limit(1);

    if (!current) {
      throw new HttpError(404, "NOT_FOUND", "current model not found");
    }

    if (challenger.domain !== body.domain || current.domain !== body.domain) {
      throw new HttpError(422, "DOMAIN_MISMATCH", "both models must match the specified domain");
    }
  });

  const id = randomUUID();
  const correlationId = ctx.correlationId ?? randomUUID();

  await queue.publish(COMMANDS.experimentCreate, {
    messageId: id,
    type: COMMANDS.experimentCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      domain: body.domain,
      name: body.name,
      challengerModelId: body.challengerModelId,
      currentModelId: body.currentModelId,
      splitPct: body.splitPct,
    },
  });

  return { id, status: "accepted", correlationId };
}

export async function experimentEnd(
  ctx: RequestContext,
  id: string,
  body: EndExperimentBody,
): Promise<Accepted> {
  const correlationId = ctx.correlationId ?? randomUUID();
  const messageId = `${id}-${Date.now()}`;

  await queue.publish(COMMANDS.experimentEnd, {
    messageId,
    type: COMMANDS.experimentEnd,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, status: body.status },
  });

  return { id, status: "accepted", correlationId };
}
