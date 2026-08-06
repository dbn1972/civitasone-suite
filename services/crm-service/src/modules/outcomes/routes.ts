/**
 * Outcome capture with reason codes (G18, spec §25.3 — journey J2 step 4).
 *
 *   GET    /v1/crm/outcome-reason-codes        — catalogue (canonical + this tenant's)
 *   GET    /v1/crm/outcome-reason-codes/:id    — read one
 *   POST   /v1/crm/outcome-reason-codes        — add a tenant code (new catalogue revision)
 *   PATCH  /v1/crm/outcome-reason-codes/:id    — amend a tenant code
 *   DELETE /v1/crm/outcome-reason-codes/:id    — retire a tenant code
 *   GET    /v1/crm/interaction-outcomes        — captured outcomes (subject/type filters)
 *   GET    /v1/crm/interaction-outcomes/:id    — read one
 *   POST   /v1/crm/interaction-outcomes        — capture an outcome
 *
 * CQRS throughout: mutations validate, publish a command and answer 202. Nothing here
 * writes to Postgres — the writes live in consumer.ts.
 *
 * Two rules are enforced here that nothing else can enforce:
 *
 *  1. A canonical reason code is IMMUTABLE — 422, for every role including super_admin. A
 *     canonical catalogue a tenant can rename is not canonical, and national reporting
 *     depends on the code meaning the same thing everywhere.
 *  2. Every precondition the consumer's guarded write relies on is checked here too, so a
 *     caller is told "no" instead of receiving 202 for a command that will be dropped. The
 *     consumer keeps its own guards regardless — this read is a snapshot.
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { listEnvelope, type ListWindow } from "../../shared/list-query.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { nextVersionNumber, validateOutcome, type RuleViolation } from "./domain.js";
import {
  idParam,
  createReasonCodeBody,
  updateReasonCodeBody,
  reasonCodeListQuery,
  recordOutcomeBody,
  outcomeListQuery,
} from "./validators.js";
import type { OutcomeReasonCodeView } from "./schema.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
/** The catalogue is governance, not day-to-day sales data. */
const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];

function windowOf(q: { limit: number; offset: number }): ListWindow {
  return { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, offset: q.offset };
}

/** Turn domain violations into the service's 422 envelope; the first code wins. */
function raiseViolations(violations: RuleViolation[]): never {
  const first = violations[0];
  throw new HttpError(
    422,
    first?.code ?? "VALIDATION_FAILED",
    violations.map((v) => v.message).join("; "),
    { violations },
  );
}

function assertVersion(expected: number, actual: number): void {
  if (expected !== actual) {
    throw new HttpError(409, "VERSION_CONFLICT", `record is at version ${actual}, not ${expected}`);
  }
}

async function loadReasonCode(tenantId: string, id: string): Promise<OutcomeReasonCodeView> {
  const found = await queries.getReasonCode(id, tenantId);
  if (!found) throw new HttpError(404, "NOT_FOUND", "outcome reason code not found");
  return found;
}

/** THE G18 GOVERNANCE GUARD. Canonical codes are visible to every tenant; none may edit. */
function assertMutable(code: OutcomeReasonCodeView): void {
  if (code.governance === "canonical") {
    throw new HttpError(
      422,
      "CANONICAL_REASON_CODE_IMMUTABLE",
      `reason code '${code.code}' is canonical and cannot be changed or removed by a tenant`,
      { code: code.code, governance: code.governance },
    );
  }
}

export async function outcomeRoutes(app: FastifyInstance): Promise<void> {
  // ── Reason-code catalogue ────────────────────────────────────────────────────

  app.get("/v1/crm/outcome-reason-codes", async (req, reply) => {
    const ctx = resolveContext(req);
    // Readable by any CRM user: the capture form needs the codes in order to offer them.
    requireRole(ctx, CRM_ROLES);
    const q = reasonCodeListQuery.parse(req.query ?? {});
    const { rows, total } = await queries.listReasonCodes(ctx.tenantId, q.limit, q.offset, {
      ...(q.category !== undefined ? { category: q.category } : {}),
      ...(q.governance !== undefined ? { governance: q.governance } : {}),
      ...(q.outcomeType !== undefined ? { outcomeType: q.outcomeType } : {}),
      ...(q.active !== undefined ? { active: q.active === "true" } : {}),
    });
    return reply.send(listEnvelope(rows, windowOf(q), total));
  });

  app.get("/v1/crm/outcome-reason-codes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: await loadReasonCode(ctx.tenantId, id) });
  });

  /**
   * Add a code. Re-POSTing an existing (category, code) issues the NEXT catalogue revision
   * rather than editing the current one, so outcomes captured under the old wording keep
   * pointing at the wording they were captured under.
   */
  app.post("/v1/crm/outcome-reason-codes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createReasonCodeBody.parse(req.body);

    const existing = await repo.findReasonCodeByCode(ctx.tenantId, body.category, body.code);
    if (existing && existing.governance === "canonical") {
      // A tenant code shadowing a canonical one would give the same code two meanings in
      // the same tenant — precisely the ambiguity a canonical catalogue removes.
      throw new HttpError(
        422,
        "CANONICAL_REASON_CODE_IMMUTABLE",
        `reason code '${body.code}' is canonical in category '${body.category}' and cannot be redefined by a tenant`,
        { code: body.code, category: body.category },
      );
    }

    const versionNumber = nextVersionNumber(
      await repo.maxVersionNumber(ctx.tenantId, body.category, body.code),
    );
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.createOutcomeReasonCode(ctx, body, versionNumber),
    );
  });

  app.patch("/v1/crm/outcome-reason-codes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateReasonCodeBody.parse(req.body);
    const current = await loadReasonCode(ctx.tenantId, id);
    assertMutable(current);
    assertVersion(body.version, current.version);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateOutcomeReasonCode(ctx, id, body));
  });

  app.delete("/v1/crm/outcome-reason-codes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const current = await loadReasonCode(ctx.tenantId, id);
    assertMutable(current);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteOutcomeReasonCode(ctx, id));
  });

  // ── Interaction outcomes ────────────────────────────────────────────────────

  app.get("/v1/crm/interaction-outcomes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = outcomeListQuery.parse(req.query ?? {});
    const { rows, total } = await queries.listOutcomes(ctx.tenantId, q.limit, q.offset, {
      ...(q.subjectType !== undefined ? { subjectType: q.subjectType } : {}),
      ...(q.subjectId !== undefined ? { subjectId: q.subjectId } : {}),
      ...(q.outcomeType !== undefined ? { outcomeType: q.outcomeType } : {}),
      ...(q.reasonCodeId !== undefined ? { reasonCodeId: q.reasonCodeId } : {}),
    });
    return reply.send(listEnvelope(rows, windowOf(q), total));
  });

  app.get("/v1/crm/interaction-outcomes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const found = await queries.getOutcome(id, ctx.tenantId);
    if (!found) throw new HttpError(404, "NOT_FOUND", "interaction outcome not found");
    return reply.send({ data: found });
  });

  /**
   * Capture an outcome. Any CRM user may — this is the agent's own record of the
   * conversation they just had, and gating it behind an admin role is how outcome capture
   * quietly stops happening.
   */
  app.post("/v1/crm/interaction-outcomes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = recordOutcomeBody.parse(req.body);

    // 404s first: an outcome against a mistyped id would never appear on any timeline.
    if (!(await repo.subjectExists(ctx.tenantId, body.subjectType, body.subjectId))) {
      throw new HttpError(404, "NOT_FOUND", `${body.subjectType} not found`, {
        subjectType: body.subjectType,
      });
    }
    const reasonCode = body.reasonCodeId === undefined
      ? null
      : await loadReasonCode(ctx.tenantId, body.reasonCodeId);
    if (
      body.followUpNextActionId !== undefined
      && !(await repo.nextActionExists(ctx.tenantId, body.followUpNextActionId))
    ) {
      throw new HttpError(404, "NOT_FOUND", "follow-up next action not found");
    }

    const violations = validateOutcome({
      outcomeType: body.outcomeType,
      reasonCode: reasonCode === null
        ? null
        : { code: reasonCode.code, active: reasonCode.active, appliesTo: reasonCode.appliesTo },
      productId: body.productId ?? null,
      amountMinor: body.amountMinor ?? null,
      currency: body.currency ?? null,
      followUpNextActionId: body.followUpNextActionId ?? null,
    });
    if (violations.length > 0) raiseViolations(violations);

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.recordInteractionOutcome(ctx, body, body.occurredAt ?? new Date().toISOString()),
    );
  });
}
