import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, isOfficer, HttpError } from "../../shared/context.js";
import {
  idParam, listQuery, createAlertBody, createNoticeBody, createSurveyBody, submitResponseBody, validateAnswers,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { toAlertDto, toNoticeDto, toSurveyDto } from "./mappers.js";

// Role sets mirror modules/catalogue/routes.ts: any citizen-portal role reads and
// answers; officer tier drafts; only admin tier publishes / withdraws / closes
// (maker-checker) and reads raw survey responses.
const CITIZEN_ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];
const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];
const ADMIN_ROLES   = ["citizen_admin", "super_admin"];

const READ_LIMIT  = { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } };
const WRITE_LIMIT = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

/** Staff may pass ?status=<stored status>|all; a bare citizen's filter is ignored (forced to the public set). */
function statusFilter(entity: queries.Entity, staff: boolean, status: string | undefined): string | undefined {
  if (!staff || status === undefined) return undefined;
  if (status !== "all" && !(queries.ALL_STATUSES[entity] as readonly string[]).includes(status)) {
    throw new HttpError(400, "VALIDATION_FAILED", `status must be one of: all, ${queries.ALL_STATUSES[entity].join(", ")}`);
  }
  return status;
}

export async function engagementRoutes(app: FastifyInstance): Promise<void> {
  // ───────────────────────────── alerts ─────────────────────────────────
  app.get("/v1/citizen/alerts", READ_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const q = listQuery.parse(req.query);
    const staff = isOfficer(ctx);
    return reply.send({ data: await queries.listAlerts(ctx.tenantId, staff, { ...q, status: statusFilter("alerts", staff, q.status) }) });
  });

  app.get("/v1/citizen/alerts/:id", READ_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getAlert(ctx.tenantId, id);
    if (!row || (!isOfficer(ctx) && row.status !== "active")) throw new HttpError(404, "NOT_FOUND", "alert not found");
    return reply.send({ data: { ...toAlertDto(row), body: row.body, expiresAt: row.expiresAt?.toISOString() ?? "" } });
  });

  app.post("/v1/citizen/alerts", WRITE_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = createAlertBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createAlert(ctx, body));
  });

  app.post("/v1/citizen/alerts/:id/publish", WRITE_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getAlert(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "alert not found");
    if (row.status !== "draft") throw new HttpError(409, "CONFLICT", `alert is ${row.status}; only a draft can be published`);
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) throw new HttpError(409, "CONFLICT", "alert expiry is already in the past");
    return sendAccepted(reply, acceptedResponseSchema, await commands.publishAlert(ctx, id));
  });

  app.post("/v1/citizen/alerts/:id/withdraw", WRITE_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getAlert(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "alert not found");
    if (row.status === "withdrawn") throw new HttpError(409, "CONFLICT", "alert is already withdrawn");
    return sendAccepted(reply, acceptedResponseSchema, await commands.withdrawAlert(ctx, id));
  });

  // ───────────────────────────── notices ────────────────────────────────
  app.get("/v1/citizen/notices", READ_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const q = listQuery.parse(req.query);
    const staff = isOfficer(ctx);
    return reply.send({ data: await queries.listNotices(ctx.tenantId, staff, { ...q, status: statusFilter("notices", staff, q.status) }) });
  });

  app.get("/v1/citizen/notices/:id", READ_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getNotice(ctx.tenantId, id);
    if (!row || (!isOfficer(ctx) && row.status !== "published")) throw new HttpError(404, "NOT_FOUND", "notice not found");
    return reply.send({ data: { ...toNoticeDto(row), body: row.body, status: row.status } });
  });

  app.post("/v1/citizen/notices", WRITE_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = createNoticeBody.parse(req.body);
    if (body.noticeNo && (await queries.getNoticeByNo(ctx.tenantId, body.noticeNo))) {
      throw new HttpError(409, "CONFLICT", "a notice with this noticeNo already exists");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createNotice(ctx, body));
  });

  app.post("/v1/citizen/notices/:id/publish", WRITE_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getNotice(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "notice not found");
    if (row.status !== "draft") throw new HttpError(409, "CONFLICT", `notice is ${row.status}; only a draft can be published`);
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) throw new HttpError(409, "CONFLICT", "notice expiry is already in the past");
    return sendAccepted(reply, acceptedResponseSchema, await commands.publishNotice(ctx, id));
  });

  app.post("/v1/citizen/notices/:id/withdraw", WRITE_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getNotice(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "notice not found");
    if (row.status === "withdrawn") throw new HttpError(409, "CONFLICT", "notice is already withdrawn");
    return sendAccepted(reply, acceptedResponseSchema, await commands.withdrawNotice(ctx, id));
  });

  // ───────────────────────────── surveys ────────────────────────────────
  app.get("/v1/citizen/surveys", READ_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const q = listQuery.parse(req.query);
    const staff = isOfficer(ctx);
    return reply.send({ data: await queries.listSurveys(ctx.tenantId, staff, { ...q, status: statusFilter("surveys", staff, q.status) }) });
  });

  app.get("/v1/citizen/surveys/:id", READ_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getSurvey(ctx.tenantId, id);
    if (!row || (!isOfficer(ctx) && row.status === "draft")) throw new HttpError(404, "NOT_FOUND", "survey not found");
    const count = await queries.surveyResponseCount(ctx.tenantId, id);
    return reply.send({ data: { ...toSurveyDto(row, count), description: row.description, questions: row.questions } });
  });

  app.post("/v1/citizen/surveys", WRITE_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = createSurveyBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createSurvey(ctx, body));
  });

  app.post("/v1/citizen/surveys/:id/publish", WRITE_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getSurvey(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "survey not found");
    if (row.status !== "draft") throw new HttpError(409, "CONFLICT", `survey is ${row.status}; only a draft can be published`);
    return sendAccepted(reply, acceptedResponseSchema, await commands.publishSurvey(ctx, id));
  });

  app.post("/v1/citizen/surveys/:id/close", WRITE_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getSurvey(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "survey not found");
    if (row.status !== "active") throw new HttpError(409, "CONFLICT", `survey is ${row.status}; only an active survey can be closed`);
    return sendAccepted(reply, acceptedResponseSchema, await commands.closeSurvey(ctx, id));
  });

  // Owner-scoped: the respondent is ALWAYS the authenticated actor (body carries no citizenId).
  app.post("/v1/citizen/surveys/:id/responses", WRITE_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = submitResponseBody.parse(req.body);
    const survey = await queries.getSurvey(ctx.tenantId, id);
    if (!survey || survey.status === "draft") throw new HttpError(404, "NOT_FOUND", "survey not found");
    if (survey.status !== "active") throw new HttpError(409, "CONFLICT", "survey is closed");
    if (await queries.getOwnResponse(ctx.tenantId, id, ctx.actorId)) {
      throw new HttpError(409, "CONFLICT", "you have already responded to this survey");
    }
    const errors = validateAnswers(survey.questions, body.answers);
    if (errors.length > 0) {
      throw new HttpError(400, "VALIDATION_FAILED", errors.slice(0, 5).join("; "));
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitSurveyResponse(ctx, id, body));
  });

  // The caller's OWN response only — officers included (they see everyone's via the staff list below).
  app.get("/v1/citizen/surveys/:id/responses/mine", READ_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getOwnResponse(ctx.tenantId, id, ctx.actorId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "no response found");
    return reply.send({ data: { id: row.id, surveyId: row.surveyId, answers: row.answers, submittedAt: row.submittedAt.toISOString() } });
  });

  app.get("/v1/citizen/surveys/:id/responses", READ_LIMIT, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query);
    if (!(await queries.getSurvey(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "survey not found");
    const rows = await queries.listResponses(ctx.tenantId, id, q.limit, q.offset);
    return reply.send({
      data: rows.map((r) => ({ id: r.id, surveyId: r.surveyId, citizenId: r.citizenId, answers: r.answers, submittedAt: r.submittedAt.toISOString() })),
    });
  });

  // Same envelope as every module in this service (see modules/requests/routes.ts).
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: err.message, correlationId, retryable: status === 429 });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
