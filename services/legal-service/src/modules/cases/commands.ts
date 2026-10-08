import { randomUUID, createHash } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateCaseBody, DisposeCaseBody, CreateCaseTypeBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * Deterministic UUID from a stable string key (SHA-256 truncated to 128 bits, RFC-4122 v5-shaped).
 * The outbox `processed.message_id` column is a UUID, so a deterministic dedup
 * key for a case-type command must itself be a UUID: the SAME (tenant, code)
 * always maps to the SAME messageId so a client/consumer retry dedups.
 */
function deterministicUuid(key: string): string {
  const h = createHash("sha256").update(`legal-case-type:${key}`).digest("hex");
  // Shape as a UUID (set version 5 + RFC-4122 variant bits).
  const b = h.slice(0, 32).split("");
  b[12] = "5";
  const variant = (parseInt(b[16]!, 16) & 0x3) | 0x8;
  b[16] = variant.toString(16);
  const s = b.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * GAP-LEGAL-CASES-NEW-01: the standard legal case-type master set (code → name).
 * Codes match the adverse-risk/classification taxonomy the web list uses: a
 * tenant can add more via createCaseType, and seedDefaultCaseTypes idempotently
 * installs this baseline so a fresh tenant's create-case select is never empty.
 */
export const DEFAULT_CASE_TYPES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "writ",        name: "Writ Petition" },
  { code: "civil",       name: "Civil Suit" },
  { code: "criminal",    name: "Criminal Case" },
  { code: "arbitration", name: "Arbitration" },
  { code: "service",     name: "Service Matter" },
  { code: "other",       name: "Other" },
];

export async function createCase(ctx: RequestContext, body: CreateCaseBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.caseCreate, {
    messageId: id, type: COMMANDS.caseCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, id, tenantId: ctx.tenantId },
  });
  await cache.put(cache.makeKey(ctx.tenantId, "case", id), { id, ...body, status: "pending" });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function disposeCase(ctx: RequestContext, caseId: string, body: DisposeCaseBody): Promise<Accepted> {
  await queue.publish(COMMANDS.caseDispose, {
    // Unlike createCase above, this had no messageId at all -- envelope()
    // defaults to a fresh random UUID per publish (bus.ts), so the
    // consumer's markProcessed() dedup could never recognize a retried
    // dispose as a duplicate: a client retry after a timeout would reach
    // assertCanDispose() a second time and throw INVALID_STATUS (already
    // disposed) instead of being idempotently absorbed as a no-op. A case
    // can only ever be meaningfully disposed once (no "reopen" action
    // exists in the domain model), so the case id itself is a safe,
    // deterministic dedup key for this specific command.
    messageId: caseId,
    type: COMMANDS.caseDispose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...body, caseId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "case", caseId));
  return { id: caseId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * GAP-LEGAL-CASES-NEW-01: create a single case-type master entry. CQRS: publish
 * the command (deterministic messageId per tenant+code so a redelivery dedups)
 * and prime the invalidation of the list cache; the consumer does the
 * idempotent DB write + audit in one tx.
 */
export async function createCaseType(ctx: RequestContext, body: CreateCaseTypeBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.caseTypeCreate, {
    // messageId keyed on (tenant, code) so a client retry of the SAME type is a
    // consumer-level no-op rather than a UNIQUE-violation surprise.
    messageId: deterministicUuid(`create:${ctx.tenantId}:${body.code}`),
    type: COMMANDS.caseTypeCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, code: body.code, name: body.name },
  });
  await cache.invalidateResource(ctx.tenantId, "case_types");
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * GAP-LEGAL-CASES-NEW-01: idempotently install the DEFAULT_CASE_TYPES baseline
 * for the tenant so a fresh tenant's create-case type select is never empty.
 * Deterministic messageId per tenant so repeated calls are a single logical
 * seed; the consumer upserts (ON CONFLICT DO NOTHING) so already-present codes
 * are untouched.
 */
export async function seedDefaultCaseTypes(ctx: RequestContext): Promise<Accepted> {
  await queue.publish(COMMANDS.caseTypeSeedDefaults, {
    messageId: deterministicUuid(`seed:${ctx.tenantId}`),
    type: COMMANDS.caseTypeSeedDefaults,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId },
  });
  await cache.invalidateResource(ctx.tenantId, "case_types");
  return { id: ctx.tenantId, status: "accepted", correlationId: ctx.correlationId };
}
