import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface RegisterInput {
  generatorName: string;
  generatorType: string;
  address: Record<string, unknown> | null;
  estimatedWasteKgPerDay: number | null;
  category: string;
  feeMinor: number | null;
}

export async function registerGenerator(ctx: RequestContext, body: RegisterInput): Promise<Accepted> {
  const id = randomUUID();
  const registrationNumber = `SWMG-${Date.now()}`;
  return publishCommand(ctx, COMMANDS.bulkGeneratorRegister, id, { id, registrationNumber, ...body });
}

export async function updateGenerator(ctx: RequestContext, id: string, patch: Record<string, unknown>, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.bulkGeneratorUpdate, id, { id, patch, version });
}

export async function suspendGenerator(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.bulkGeneratorSuspend, id, { id, version });
}
