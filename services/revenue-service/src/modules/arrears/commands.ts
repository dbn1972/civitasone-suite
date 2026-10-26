import { publishCommand } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "../../shared/context.js";

export function createInstalment(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.instalmentPlanCreate, ctx, payload);
}

export function decideInstalmentPlan(ctx: RequestContext, planId: string, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.instalmentPlanDecide, ctx, { ...payload, planId });
}

export function createWriteOff(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.writeOffCreate, ctx, payload);
}

export function decideWriteOff(ctx: RequestContext, writeOffId: string, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.writeOffDecide, ctx, { ...payload, writeOffId });
}

export function decideRecoveryReferral(ctx: RequestContext, referralId: string, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.recoveryReferDecide, ctx, { ...payload, referralId });
}

export function serveDemandNotice(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.demandNoticeServe, ctx, payload);
}

export function referRecovery(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.recoveryRefer, ctx, payload);
}

export function createWaiver(ctx: RequestContext, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.waiverCreate, ctx, payload);
}

export function decideWaiver(ctx: RequestContext, waiverId: string, payload: Record<string, unknown>) {
  return publishCommand(COMMANDS.waiverDecide, ctx, { ...payload, waiverId });
}
