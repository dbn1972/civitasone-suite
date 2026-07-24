import { publishCommand } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "../../shared/context.js";

export function createAssessee(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.assesseeCreate, ctx, payload);
}

export function updateAssessee(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.assesseeUpdate, ctx, payload);
}
