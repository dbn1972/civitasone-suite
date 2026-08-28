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
  // string, not number or bigint: re-review fix — these are now always
  // server-derived from the property's own fields (routes.ts calls
  // `property.monthlyRentMinor?.toString()`), a bigint converted to string,
  // never a client-supplied value. String (not native bigint) for the same
  // JSON.stringify/queue.publish() reason documented in properties/commands.ts.
  monthlyRentMinor?: string | undefined;
  securityDepositMinor?: string | undefined;
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
