/**
 * CO-001 — CQRS write path for send / bulk-send communication.
 */
import type { RequestContext } from "@civitasone/types";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand, type Accepted } from "../../shared/residual-publish.js";
import type { SendCommunicationBody, BulkSendCommunicationBody } from "./send-validators.js";

export type { Accepted };

export const sendCommunication = (
  ctx: RequestContext,
  id: string,
  body: SendCommunicationBody,
): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.sendCommunication, id, {
    recipientContactId: body.recipientContactId,
    templateId: body.templateId,
    channel: body.channel,
    variables: body.variables ?? {},
    scheduledAt: body.scheduledAt ?? null,
  });

export const bulkSendCommunication = (
  ctx: RequestContext,
  id: string,
  body: BulkSendCommunicationBody,
  eligibleContactIds: string[],
): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.bulkSendCommunication, id, {
    contactIds: eligibleContactIds,
    templateId: body.templateId,
    channel: body.channel,
    variables: body.variables ?? {},
    scheduledAt: body.scheduledAt ?? null,
  });
