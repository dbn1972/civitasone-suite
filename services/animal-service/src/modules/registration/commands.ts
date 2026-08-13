import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface RegisterAnimalInput {
  ownerName: string;
  ownerPhone: string;
  ownerAddress: { line1: string; line2?: string | undefined; city: string; pin: string };
  animalType: string;
  breed?: string | undefined;
  name?: string | undefined;
  color?: string | undefined;
  age?: number | undefined;
  sex?: string | undefined;
  microchipId?: string | undefined;
  vaccinationRecords?: Array<{ vaccine: string; date: string; nextDue?: string | undefined; vet?: string | undefined }> | undefined;
  photo?: string | undefined;
}

export async function registerAnimal(ctx: RequestContext, body: RegisterAnimalInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.registerAnimal, id, { id, ...body });
}

export async function renewRegistration(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.renewRegistration, id, { id });
}

export async function transferRegistration(
  ctx: RequestContext,
  id: string,
  newOwnerName: string,
  newOwnerPhone: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.transferRegistration, id, { id, newOwnerName, newOwnerPhone });
}
