import { publishCommand } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "../../shared/context.js";

export function generateBill(ctx: RequestContext, payload: { assessmentId: string }) {
  return publishCommand(COMMANDS.billGenerate, ctx, payload);
}
