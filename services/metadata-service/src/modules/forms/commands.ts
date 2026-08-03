import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
export type { Accepted };
export async function mutateForm(ctx: RequestContext, op: string, payload: Record<string, unknown>): Promise<Accepted> {
  const id = (payload.id as string) || randomUUID();
  return publishCommand(ctx, COMMANDS.FORM_MUTATE, id, { op, ...payload });
}
