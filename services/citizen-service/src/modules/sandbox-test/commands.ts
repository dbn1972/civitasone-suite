import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as catalogueRepo from "../catalogue/repo.js";
import { runSandboxPipeline } from "./domain.js";
import { definitionDesignHash } from "./design-hash.js";
import * as repo from "./repo.js";

export interface SandboxRunResponse {
  id: string;
  passed: boolean;
  status: "pass" | "fail";
  steps: ReturnType<typeof runSandboxPipeline>["steps"];
  durationMs: number;
}

/** Run synthetic pipeline synchronously and persist result (FN-10). */
export async function runSandboxTest(ctx: RequestContext, definitionId: string): Promise<SandboxRunResponse> {
  const def = await catalogueRepo.findDefinitionById(definitionId, ctx.tenantId);
  if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
  if (def.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be tested");

  const started = Date.now();
  const definitionHash = definitionDesignHash(def);
  const result = runSandboxPipeline(def);
  const durationMs = Date.now() - started;
  const runId = randomUUID();
  const status = result.passed ? "pass" : "fail";

  await db.transaction(async (tx) => {
    await repo.insertRun(tx, {
      id: runId,
      tenantId: ctx.tenantId,
      serviceDefinitionId: definitionId,
      status,
      steps: result.steps,
      durationMs,
      definitionHash,
      createdBy: ctx.actorId,
    });
  });

  return { id: runId, passed: result.passed, status, steps: result.steps, durationMs };
}

/**
 * Submit gate: the latest run must have passed AND tested the design as it is
 * NOW. A pass recorded against an earlier design (or before the hash was
 * recorded) is stale and rejected with its own code so the designer knows to
 * re-run rather than debug a failure.
 */
export async function assertLatestTestPassed(ctx: RequestContext, definitionId: string): Promise<void> {
  const latest = await repo.latestRunForDefinition(ctx.tenantId, definitionId);
  if (!latest || latest.status !== "pass") {
    throw new HttpError(409, "TEST_NOT_PASSED", "latest sandbox test must pass before submit");
  }
  const def = await catalogueRepo.findDefinitionById(definitionId, ctx.tenantId);
  if (!def) throw new HttpError(404, "NOT_FOUND", "service definition not found");
  if (!isRunCurrent(latest.definitionHash, def)) {
    throw new HttpError(409, "TEST_STALE", "the design changed after the last passing sandbox test; run the test again before submit or publish");
  }
}

/**
 * Transactional form of the same gate for the publish consumer: the design that
 * goes live must be the design the latest passing run tested, even if it was
 * edited after submit.
 */
export async function isLatestTestCurrentTx(
  tx: Parameters<typeof repo.latestRunForDefinitionTx>[0],
  tenantId: string,
  def: Parameters<typeof definitionDesignHash>[0] & { id: string },
): Promise<boolean> {
  const latest = await repo.latestRunForDefinitionTx(tx, tenantId, def.id);
  return !!latest && latest.status === "pass" && isRunCurrent(latest.definitionHash, def);
}

/** True when a run's recorded hash matches the definition as it stands. NULL (pre-0040) is never current. */
export function isRunCurrent(runHash: string | null | undefined, def: Parameters<typeof definitionDesignHash>[0]): boolean {
  return typeof runHash === "string" && runHash.length > 0 && runHash === definitionDesignHash(def);
}
