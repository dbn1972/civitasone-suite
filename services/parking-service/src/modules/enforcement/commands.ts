import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface IssueViolationInput {
  location?: { lat?: number | undefined; lng?: number | undefined; address?: string | undefined; zone?: string | undefined } | undefined;
  vehicleNumber: string;
  violationType: string;
  photo?: string | undefined;
  challanRef?: string | undefined;
}

export async function issueViolation(ctx: RequestContext, body: IssueViolationInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.issueViolation, id, { id, ...body });
}

export async function payViolation(ctx: RequestContext, id: string, paymentRef: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.payViolation, id, { id, paymentRef });
}

export async function contestViolation(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.contestViolation, id, { id, reason });
}
