import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface ApplyAllotmentInput {
  propertyId: string;
  allotteeName: string;
  allotteePhone?: string | undefined;
  allotteeAadhaar?: string | undefined;
  allotmentType: string;
  // number, not bigint — see properties/commands.ts for the full explanation
  // (native bigint crashes JSON.stringify in queue.publish() on real drivers).
  monthlyRentMinor?: number | undefined;
  securityDepositMinor?: number | undefined;
}

export async function applyAllotment(ctx: RequestContext, body: ApplyAllotmentInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.applyAllotment, id, { id, ...body } as Record<string, unknown>);
}

export async function selectAllottee(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.selectAllottee, id, { id });
}

export async function signAgreement(
  ctx: RequestContext,
  id: string,
  agreementStartDate: string,
  agreementEndDate: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.signAgreement, id, { id, agreementStartDate, agreementEndDate });
}
