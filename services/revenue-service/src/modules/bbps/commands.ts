import { publishCommand } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "../../shared/context.js";

export function fetchBill(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.bbpsFetchBill, ctx, payload);
}

export function payBill(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.bbpsPayBill, ctx, payload);
}
