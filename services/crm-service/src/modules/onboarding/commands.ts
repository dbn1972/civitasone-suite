import type { RequestContext } from "@civitasone/types";
import { publishCrmCommand, type Accepted } from "../../shared/residual-publish.js";
import { COMMANDS } from "../../topics.js";
import { invalidateCase } from "./queries.js";
import type { KycStatus, OnboardingStage } from "./domain.js";

export interface AdvanceStageCommand {
  toStage: OnboardingStage;
  fromStage: OnboardingStage;
  cancellationReason: string | null;
  version: number;
}

export interface RecordKycCommand {
  toStatus: KycStatus;
  fromStatus: KycStatus;
  reference: string | null;
  version: number;
}

export async function advanceStage(
  ctx: RequestContext,
  id: string,
  cmd: AdvanceStageCommand,
): Promise<Accepted> {
  const accepted = await publishCrmCommand(ctx, COMMANDS.advanceOnboardingStage, id, { ...cmd });
  await invalidateCase(ctx.tenantId, id);
  return accepted;
}

export async function recordKyc(
  ctx: RequestContext,
  id: string,
  cmd: RecordKycCommand,
): Promise<Accepted> {
  const accepted = await publishCrmCommand(ctx, COMMANDS.recordOnboardingKyc, id, { ...cmd });
  await invalidateCase(ctx.tenantId, id);
  return accepted;
}
