import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
export type { Accepted };
export async function createItem(ctx: RequestContext, body: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.RULE_CREATE, id, body);
}
export async function updateItem(ctx: RequestContext, id: string, body: Record<string, unknown>): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.RULE_UPDATE, id, body);
}
export async function deleteItem(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.RULE_DELETE, id, {});
}
