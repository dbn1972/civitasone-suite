import { publishCommand } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "../../shared/context.js";

export function createInstalment(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.instalmentPlanCreate, ctx, payload);
}

export function createWriteOff(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.writeOffCreate, ctx, payload);
}

export function decideWriteOff(ctx: RequestContext, writeOffId: string, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.writeOffDecide, ctx, { ...payload, writeOffId });
}

export function referRecovery(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.recoveryRefer, ctx, payload);
}

export function createWaiver(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand("revenue.waiver.create", ctx, payload);
}

export function decideWaiver(ctx: RequestContext, waiverId: string, payload: Record<string, unknown>) {
  return publishCommand("revenue.waiver.decide", ctx, { ...payload, waiverId });
}
