import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as catalogueRepo from "../catalogue/repo.js";
import { runSandboxPipeline } from "./domain.js";
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
      createdBy: ctx.actorId,
    });
  });

  return { id: runId, passed: result.passed, status, steps: result.steps, durationMs };
}

export async function assertLatestTestPassed(ctx: RequestContext, definitionId: string): Promise<void> {
  const latest = await repo.latestRunForDefinition(ctx.tenantId, definitionId);
  if (!latest || latest.status !== "pass") {
    throw new HttpError(409, "TEST_NOT_PASSED", "latest sandbox test must pass before submit");
  }
}
