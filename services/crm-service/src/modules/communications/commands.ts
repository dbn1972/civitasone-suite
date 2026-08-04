/**
 * AC-003 communication log — CQRS write path. The route returns 202 and the
 * consumer applies the row (matching the roles/next-action modules).
 */
import type { RequestContext } from "@civitasone/types";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand, type Accepted } from "../../shared/residual-publish.js";
import type { CreateCommunicationBody } from "./validators.js";

export type { Accepted };

export const createCommunication = (
  ctx: RequestContext,
  id: string,
  body: CreateCommunicationBody,
): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.createCommunication, id, {
    subjectType: body.subjectType,
    subjectId: body.subjectId,
    direction: body.direction,
    channel: body.channel,
    outcome: body.outcome ?? null,
    disposition: body.disposition ?? null,
    summary: body.summary ?? null,
    // The route stamps occurredAt so the consumer never invents "now" on redelivery.
    occurredAt: body.occurredAt ?? new Date().toISOString(),
  });
