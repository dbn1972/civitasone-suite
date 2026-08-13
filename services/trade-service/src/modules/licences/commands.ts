import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function issueLicence(ctx: RequestContext, applicationId: string, tradeCategory: string, validityMonths?: number): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.issueLicence, id, { id, applicationId, tradeCategory, validityMonths: validityMonths ?? 12 });
}

export async function suspendLicence(ctx: RequestContext, licenceId: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.suspendLicence, licenceId, { licenceId, reason });
}

export async function cancelLicence(ctx: RequestContext, licenceId: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.cancelLicence, licenceId, { licenceId, reason });
}

export async function restoreLicence(ctx: RequestContext, licenceId: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.restoreLicence, licenceId, { licenceId, reason });
}

export async function issueNotice(ctx: RequestContext, licenceId: string, noticeDetails: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.issueNotice, id, { id, licenceId, noticeDetails });
}
