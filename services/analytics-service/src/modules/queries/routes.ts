import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { catalog } from "../registry/registry.js";
import {
  runQueryBody,
  scheduleQueryBody,
  createExportBody,
  queryRunViewSchema,
  queryRunsListSchema,
  scheduledListSchema,
  exportsListSchema,
  catalogSchema,
  idParam,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ROLES = ["analytics_user", "analytics_admin", "super_admin"];

export async function queryRoutes(app: FastifyInstance): Promise<void> {
  // Discovery: the whitelisted catalog the UI builds queries from.
  app.get("/v1/analytics/catalog", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    sendValidated(reply, catalogSchema, catalog());
  });

  app.post("/v1/analytics/queries/run", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = runQueryBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.runQuery(ctx, body));
  });

  app.get("/v1/analytics/queries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, queryRunsListSchema, await queries.listQueryRuns(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/analytics/queries/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const run = await queries.getQueryRun(ctx.tenantId, id);
    if (!run) throw new HttpError(404, "NOT_FOUND", "query run not found");
    sendValidated(reply, queryRunViewSchema, run);
  });

  app.post("/v1/analytics/scheduled", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = scheduleQueryBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.scheduleQuery(ctx, body));
  });

  app.get("/v1/analytics/scheduled", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, scheduledListSchema, await queries.listScheduled(ctx.tenantId, q.limit, q.offset));
  });

  app.post("/v1/analytics/exports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createExportBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.createExport(ctx, body));
  });

  app.get("/v1/analytics/exports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, exportsListSchema, await queries.listExports(ctx.tenantId, q.limit, q.offset));
  });

  /** Download an export file — redirects to the presigned S3 URL */
  app.get("/v1/analytics/exports/:id/download", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const exp = await queries.getExport(ctx.tenantId, id);
    if (!exp) throw new HttpError(404, "NOT_FOUND", "export not found");
    if (exp.status !== "completed" || !exp.downloadUrl) {
      throw new HttpError(409, "NOT_READY", "export is not yet completed");
    }
    // If it's a relative path, build the presigned URL; if absolute, redirect
    if (exp.downloadUrl.startsWith("http")) {
      return reply.redirect(302, exp.downloadUrl);
    }
    // Fallback: return the URL in the response body
    return reply.send({ downloadUrl: exp.downloadUrl });
  });

  registerErrorHandler(app);
}
