import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { catalog } from "../registry/registry.js";
import {
  runQueryBody,
  scheduleQueryBody,
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

  app.get("/v1/analytics/exports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, exportsListSchema, await queries.listExports(ctx.tenantId, q.limit, q.offset));
  });

  registerErrorHandler(app);
}
