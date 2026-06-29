import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface UpdateProvisionInput {
  tenantId: string;
  status: "provisioning" | "ready" | "failed";
  error?: string | null | undefined;
  steps?: Array<{ step: string; ok: boolean; detail?: string | undefined }> | undefined;
}

export async function updateProvision(ctx: RequestContext, id: string, input: UpdateProvisionInput): Promise<Accepted> {
  await queue.publish(COMMANDS.siloProvisionUpdate, {
    messageId: randomUUID(),
    type: COMMANDS.siloProvisionUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: input.tenantId, status: input.status, error: input.error ?? null, ...(input.steps ? { steps: input.steps } : {}) },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
