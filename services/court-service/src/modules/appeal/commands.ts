import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveAppealId, assertTransition, type AppealStatus } from "./domain.js";
import { getAppeal } from "./repo.js";
import { httpError, assertVersionAndTransition } from "../../shared/context.js";
import {
  fileAppealBody, type FileAppealBody,
  registerAppealBody, type RegisterAppealBody,
  decideAppealBody, type DecideAppealBody,
  withdrawAppealBody, type WithdrawAppealBody,
} from "./validators.js";

export type FileAppealResult = { accepted: true; appealId: string };
export type RegisterAppealResult = { accepted: true; appealId: string };
export type DecideAppealResult = { accepted: true; appealId: string };
export type WithdrawAppealResult = { accepted: true; appealId: string };

/** File an appeal (§25). Idempotent per (original case + appeal type + filed date). */
export async function fileAppeal(
  ctx: RequestContext, input: FileAppealBody,
): Promise<FileAppealResult> {
  const body = fileAppealBody.parse(input);
  const appealType = body.appealType ?? "appeal";
  const appealId = deriveAppealId(ctx.tenantId, body.originalCaseId, appealType, body.filedDate);

  await queue.publish(COMMANDS.fileAppeal, {
    messageId: appealId,
    type: COMMANDS.fileAppeal,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, appealType, id: appealId, tenantId: ctx.tenantId },
  });

  return { accepted: true, appealId };
}

async function loadAppealForPrecheck(tenantId: string, appealId: string) {
  const current = await getAppeal(tenantId, appealId);
  if (!current) throw httpError("APPEAL_NOT_FOUND", `Appeal not found: ${appealId}`);
  return current;
}

/**
 * Register a filed appeal (§25). messageId is idempotent per (appeal + expectedVersion).
 *
 * Synchronous pre-check mirrors the consumer's shared `transition()` helper
 * exactly (same assertTransition, same order) so an illegal transition (e.g.
 * registering an appeal that's already been decided) is an immediate, honest
 * 4xx instead of a 202 that silently dead-letters. The consumer's identical
 * check remains the authoritative backstop for the race window between this
 * read and the eventual write.
 */
export async function registerAppeal(
  ctx: RequestContext, appealId: string, input: RegisterAppealBody,
): Promise<RegisterAppealResult> {
  const body = registerAppealBody.parse(input);

  const current = await loadAppealForPrecheck(ctx.tenantId, appealId);
  assertVersionAndTransition(current, body.expectedVersion, "registered", assertTransition, {
    versionConflict: "APPEAL_VERSION_CONFLICT",
    invalidTransition: "APPEAL_INVALID_TRANSITION",
  });

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:appeal-register:${appealId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.registerAppeal, {
    messageId,
    type: COMMANDS.registerAppeal,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { appealId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, appealId };
}

/** Decide a registered appeal (§25). messageId is idempotent per (appeal + expectedVersion).
 *  Synchronous pre-check -- see registerAppeal's doc comment for why. */
export async function decideAppeal(
  ctx: RequestContext, appealId: string, input: DecideAppealBody,
): Promise<DecideAppealResult> {
  const body = decideAppealBody.parse(input);

  const current = await loadAppealForPrecheck(ctx.tenantId, appealId);
  const target: AppealStatus = body.decision;
  assertVersionAndTransition(current, body.expectedVersion, target, assertTransition, {
    versionConflict: "APPEAL_VERSION_CONFLICT",
    invalidTransition: "APPEAL_INVALID_TRANSITION",
  });

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:appeal-decide:${appealId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.decideAppeal, {
    messageId,
    type: COMMANDS.decideAppeal,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { appealId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, appealId };
}

/** Withdraw an appeal (§25). messageId is idempotent per (appeal + expectedVersion).
 *  Synchronous pre-check -- see registerAppeal's doc comment for why. */
export async function withdrawAppeal(
  ctx: RequestContext, appealId: string, input: WithdrawAppealBody,
): Promise<WithdrawAppealResult> {
  const body = withdrawAppealBody.parse(input);

  const current = await loadAppealForPrecheck(ctx.tenantId, appealId);
  assertVersionAndTransition(current, body.expectedVersion, "withdrawn", assertTransition, {
    versionConflict: "APPEAL_VERSION_CONFLICT",
    invalidTransition: "APPEAL_INVALID_TRANSITION",
  });

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:appeal-withdraw:${appealId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.withdrawAppeal, {
    messageId,
    type: COMMANDS.withdrawAppeal,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { appealId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, appealId };
}
