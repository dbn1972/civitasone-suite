import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { assertDistinctMakerChecker, DomainError } from "./domain.js";
import { assertModeAllowedForValue, GfrModeError, type ProcurementMode } from "../gfr/mode-bands.js";
import type { CreateIndentBody, ApproveIndentBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createIndent(ctx: RequestContext, body: CreateIndentBody): Promise<Accepted> {
  // GFR mode-bands: if the requisitioner names a procurement mode, reject a mode
  // that violates the value band for the indent's estimated value (paise) with a
  // synchronous 400. Estimated value = sum(unitPriceMinor * quantity).
  if (body.procurementMode) {
    const estimatedMinor = body.items.reduce(
      (s, i) => s + BigInt(i.unitPriceMinor) * BigInt(i.quantity), 0n,
    );
    try {
      assertModeAllowedForValue(body.procurementMode as ProcurementMode, estimatedMinor);
    } catch (err) {
      if (err instanceof GfrModeError) throw new HttpError(400, err.code, err.message);
      throw err;
    }
  }

  const id = randomUUID();
  await queue.publish(COMMANDS.indentCreate, {
    messageId: id, type: COMMANDS.indentCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveIndent(ctx: RequestContext, id: string, body: ApproveIndentBody): Promise<Accepted> {
  // Segregation of duties (#9): reject self-approval synchronously with 403.
  const indent = await repo.findIndentById(id);
  if (!indent || indent.tenantId !== ctx.tenantId) {
    throw new HttpError(404, "NOT_FOUND", "indent not found");
  }
  try {
    assertDistinctMakerChecker(indent.createdBy, ctx.actorId);
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(403, err.code, err.message);
    throw err;
  }

  await queue.publish(COMMANDS.indentApprove, {
    type: COMMANDS.indentApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "indent", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
