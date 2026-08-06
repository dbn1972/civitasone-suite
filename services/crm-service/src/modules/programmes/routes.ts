/**
 * Government programme / engagement routes (G12 — Spec §25.7, Journey J6).
 *
 * GET    /v1/crm/programmes                        — list (status / accountId / productLine)
 * POST   /v1/crm/programmes                        — register a programme
 * GET    /v1/crm/programmes/:id                    — read one
 * PATCH  /v1/crm/programmes/:id                    — amend metadata (optimistic lock)
 * POST   /v1/crm/programmes/:id/status             — lifecycle transition
 * GET    /v1/crm/programmes/:id/metrics            — per-period metric series
 * POST   /v1/crm/programmes/:id/metrics            — record / correct one period's metric
 * GET    /v1/crm/programmes/:id/execution-health   — the J6 roll-up
 * POST   /v1/crm/programmes/:id/deals/:dealId      — register an opportunity under it
 *
 * CQRS: every write validates with zod, publishes a command and returns 202. No handler in
 * this file writes to Postgres.
 *
 * Every precondition the consumer's guarded write enforces is ALSO checked here against
 * the row the route already reads, because a 202 followed by a consumer that silently
 * drops the command tells the caller its change landed when it did not. The consumer keeps
 * its own guards regardless — this read is a snapshot and cannot be trusted to still hold.
 *
 * A programme belonging to another tenant answers 404, never 403: whether a programme code
 * exists in some other department is not information this API should confirm.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { HttpError, requireRole, resolveContext } from "../../shared/context.js";
import { listEnvelope, windowOf } from "../../shared/list-query.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import {
  DEFAULT_PRODUCT_LINE,
  INITIAL_STATUS,
  acceptsMetrics,
  allowedNextStatuses,
  canTransition,
  classifyMetric,
  isOrderedRange,
  isProgrammeStatus,
  normaliseCoverageScope,
  normaliseMetricValue,
  type ProgrammeStatus,
} from "./domain.js";
import {
  createProgrammeBody,
  healthQuery,
  idParam,
  linkDealBody,
  metricListQuery,
  programmeDealParam,
  programmeListQuery,
  recordMetricBody,
  statusBody,
  updateProgrammeBody,
} from "./validators.js";
import type { ProgrammeView } from "./schema.js";

/** Reading a programme is a normal CRM activity. */
const READ_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
/**
 * Registering, amending and transitioning a programme is a governance action with revenue
 * and SLA consequences, so it is admin-only. A `crm_user` can read every programme and
 * record nothing.
 */
const WRITE_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

/** Load the programme or 404. Also rejects a status the domain does not recognise. */
async function loadProgramme(tenantId: string, id: string): Promise<ProgrammeView> {
  const found = await queries.getProgramme(id, tenantId);
  if (!found) throw new HttpError(404, "NOT_FOUND", "programme not found");
  if (!isProgrammeStatus(found.status)) {
    throw new HttpError(422, "INVALID_STATE", `stored status '${found.status}' is not recognised`);
  }
  return found;
}

/** The consumer's UPDATE is guarded on version, so a stale one is a silent no-op after 202. */
function assertVersion(expected: number, actual: number): void {
  if (expected !== actual) {
    throw new HttpError(
      409,
      "VERSION_CONFLICT",
      `programme is at version ${actual}, not ${expected}`,
    );
  }
}

export async function programmeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/programmes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = programmeListQuery.parse(req.query ?? {});
    const w = windowOf(q);
    const { rows, total } = await queries.listProgrammes(ctx.tenantId, w.pageSize, w.offset, {
      ...(q.status ? { status: q.status } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.productLine ? { productLine: q.productLine } : {}),
    });
    return reply.send(listEnvelope(rows, w, total));
  });

  app.post("/v1/crm/programmes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createProgrammeBody.parse(req.body);

    if (!isOrderedRange(body.startDate, body.endDate)) {
      throw new HttpError(
        400,
        "INVALID_DATE_RANGE",
        `startDate ${body.startDate} is after endDate ${body.endDate}`,
      );
    }

    // Checked here so a duplicate registration is a 409 the operator can act on, rather
    // than a 202 whose command the consumer quietly converges away.
    const existing = await queries.getProgrammeByCode(body.programmeCode, ctx.tenantId);
    if (existing) {
      throw new HttpError(
        409,
        "DUPLICATE_PROGRAMME_CODE",
        `programmeCode '${body.programmeCode}' is already registered in this tenant`,
      );
    }

    const id = randomUUID();
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.createProgramme(ctx, id, {
        programmeCode: body.programmeCode,
        name: body.name,
        description: body.description ?? null,
        accountId: body.accountId,
        contractId: body.contractId ?? null,
        productLine: body.productLine ?? DEFAULT_PRODUCT_LINE,
        startDate: body.startDate ?? null,
        endDate: body.endDate ?? null,
        sponsoringDepartment: body.sponsoringDepartment ?? null,
        coverageScope: normaliseCoverageScope(body.coverageScope),
        status: INITIAL_STATUS,
      }),
    );
  });

  app.get("/v1/crm/programmes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: await loadProgramme(ctx.tenantId, id) });
  });

  app.patch("/v1/crm/programmes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateProgrammeBody.parse(req.body);
    const current = await loadProgramme(ctx.tenantId, id);
    assertVersion(body.version, current.version);

    // A closed programme is a historic record. Editing its metadata would rewrite what a
    // past engagement said it covered, which is exactly what an audit needs to be stable.
    if (current.status === "closed") {
      throw new HttpError(422, "PROGRAMME_CLOSED", "a closed programme cannot be amended");
    }

    const nextStart = body.startDate !== undefined ? body.startDate : current.startDate;
    const nextEnd = body.endDate !== undefined ? body.endDate : current.endDate;
    if (!isOrderedRange(nextStart, nextEnd)) {
      throw new HttpError(
        400,
        "INVALID_DATE_RANGE",
        `startDate ${nextStart} is after endDate ${nextEnd}`,
      );
    }

    const { version, ...changed } = body;
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.updateProgramme(ctx, id, { changed, version }),
    );
  });

  app.post("/v1/crm/programmes/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = statusBody.parse(req.body);
    const current = await loadProgramme(ctx.tenantId, id);
    assertVersion(body.version, current.version);

    const from = current.status as ProgrammeStatus;
    if (!canTransition(from, body.status)) {
      const allowed = allowedNextStatuses(from);
      throw new HttpError(
        422,
        "INVALID_TRANSITION",
        allowed.length === 0
          ? `'${from}' is terminal; no further transitions are allowed`
          : `cannot move from '${from}' to '${body.status}' (allowed: ${allowed.join(", ")})`,
      );
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.changeProgrammeStatus(ctx, id, {
        fromStatus: from,
        toStatus: body.status,
        reason: body.reason?.trim() ?? null,
        version: current.version,
      }),
    );
  });

  app.get("/v1/crm/programmes/:id/metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = metricListQuery.parse(req.query ?? {});
    // 404s a metric read for a programme that is not this tenant's, so the endpoint cannot
    // be used to probe for programme ids.
    await loadProgramme(ctx.tenantId, id);
    const w = windowOf(q);
    const { rows, total } = await queries.listProgrammeMetrics(
      ctx.tenantId,
      id,
      w.pageSize,
      w.offset,
      {
        ...(q.metricKey ? { metricKey: q.metricKey } : {}),
        ...(q.periodStartFrom ? { periodStartFrom: q.periodStartFrom } : {}),
        ...(q.periodStartTo ? { periodStartTo: q.periodStartTo } : {}),
      },
    );
    return reply.send(listEnvelope(rows, w, total));
  });

  app.post("/v1/crm/programmes/:id/metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = recordMetricBody.parse(req.body);
    const current = await loadProgramme(ctx.tenantId, id);

    if (!acceptsMetrics(current.status as ProgrammeStatus)) {
      throw new HttpError(
        422,
        "PROGRAMME_NOT_EXECUTING",
        `a '${current.status}' programme has no execution to report on — activate it first`,
      );
    }

    if (!isOrderedRange(body.periodStart, body.periodEnd)) {
      throw new HttpError(
        400,
        "INVALID_PERIOD",
        `periodStart ${body.periodStart} is after periodEnd ${body.periodEnd}`,
      );
    }

    const normalised = normaliseMetricValue({
      metricKey: body.metricKey,
      metricKind: body.metricKind ?? classifyMetric(body.metricKey),
      value: body.value,
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
    });
    if (!normalised.ok) {
      throw new HttpError(400, normalised.code, normalised.message);
    }

    const metricId = randomUUID();
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.recordProgrammeMetric(ctx, metricId, {
        programmeId: id,
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        metricKey: body.metricKey,
        metricKind: normalised.value.metricKind,
        // Money stays a string all the way to the consumer. See topics.ts.
        valueMinor: normalised.value.valueMinor === null ? null : normalised.value.valueMinor.toString(),
        currency: normalised.value.currency,
        valueNumeric: normalised.value.valueNumeric,
      }),
    );
  });

  app.get("/v1/crm/programmes/:id/execution-health", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = healthQuery.parse(req.query ?? {});
    const programme = await loadProgramme(ctx.tenantId, id);
    const health = await queries.getExecutionHealth(ctx.tenantId, id, {
      ...(q.periodStartFrom ? { periodStartFrom: q.periodStartFrom } : {}),
      ...(q.periodStartTo ? { periodStartTo: q.periodStartTo } : {}),
    });
    return reply.send({
      data: {
        programmeId: programme.id,
        programmeCode: programme.programmeCode,
        status: programme.status,
        ...health,
      },
    });
  });

  app.post("/v1/crm/programmes/:id/deals/:dealId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id, dealId } = programmeDealParam.parse(req.params);
    const body = linkDealBody.parse(req.body);
    const programme = await loadProgramme(ctx.tenantId, id);

    if (programme.status === "closed") {
      throw new HttpError(
        422,
        "PROGRAMME_CLOSED",
        "a closed programme cannot take on new opportunities",
      );
    }

    // Read through the repo, not the deals module: this route needs the deal's version and
    // current linkage, and pulling in the deals read model would couple the two modules.
    const deal = await repo.dealLinkSnapshot(ctx.tenantId, dealId);
    if (!deal) throw new HttpError(404, "NOT_FOUND", "deal not found");
    if (deal.version !== body.dealVersion) {
      throw new HttpError(
        409,
        "VERSION_CONFLICT",
        `deal is at version ${deal.version}, not ${body.dealVersion}`,
      );
    }
    if (deal.programmeId !== null && deal.programmeId !== id) {
      throw new HttpError(
        409,
        "DEAL_ALREADY_LINKED",
        `deal is already registered under programme ${deal.programmeId}`,
      );
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.linkDealToProgramme(ctx, id, { dealId, dealVersion: body.dealVersion }),
    );
  });
}
