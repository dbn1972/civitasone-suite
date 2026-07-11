import { createHash } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { validateCnr } from "./domain.js";
import { registerCaseBody, type RegisterCaseBody } from "./validators.js";

export type RegisterCaseResult = { accepted: true; caseId: string };

/**
 * Deterministic UUIDv5 (RFC 4122 §4.3) over a fixed namespace + name. Deriving
 * the case id from (tenantId + normalized CNR) makes case registration
 * idempotent end-to-end: a duplicate submit produces the SAME messageId AND the
 * SAME caseId, so the consumer's markProcessed dedupe is a true no-op and the
 * caller always gets back the one canonical id for that CNR.
 */
const CASE_NAMESPACE = "6f3a1e2c-0b7d-4e11-9a4c-2f8b1d5e7c90";

function deterministicCaseId(tenantId: string, normalizedCnr: string): string {
  const nsBytes = Buffer.from(CASE_NAMESPACE.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(`${tenantId}:${normalizedCnr}`, "utf8");
  const hash = createHash("sha1").update(nsBytes).update(nameBytes).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function registerCase(ctx: RequestContext, input: RegisterCaseBody): Promise<RegisterCaseResult> {
  const body = registerCaseBody.parse(input);
  const cnrNumber = validateCnr(body.cnrNumber);
  const caseId = deterministicCaseId(ctx.tenantId, cnrNumber);

  await queue.publish(COMMANDS.registerCase, {
    messageId: caseId,
    type: COMMANDS.registerCase,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, cnrNumber, id: caseId, tenantId: ctx.tenantId },
  });

  return { accepted: true, caseId };
}
