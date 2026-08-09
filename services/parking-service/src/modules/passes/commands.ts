import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreatePassInput {
  facilityId: string;
  holderName: string;
  vehicleNumber: string;
  vehicleType: string;
  passType: string;
  validFrom: string;
  paymentRef?: string | undefined;
}

export async function createPass(ctx: RequestContext, body: CreatePassInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createPass, id, { id, ...body });
}

export async function cancelPass(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.cancelPass, id, { id });
}
