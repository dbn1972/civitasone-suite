import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { registerErrorHandler } from "../../shared/errors.js";
import {
  dashboardsListSchema,
  dashboardDetailSchema,
  createDashboardBody,
  updateDashboardBody,
  addWidgetBody,
  shareDashboardBody,
  idParam,
} from "./validators.js";
import * as queries from "./queries.js";
import * as commands from "./commands.js";

const READ_ROLES = ["analytics_user", "analytics_admin", "report_admin", "report_viewer", "super_admin", "tenant_admin"];
const WRITE_ROLES = ["analytics_user", "analytics_admin", "report_admin", "super_admin", "tenant_admin"];

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/analytics/dashboards", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, dashboardsListSchema, await queries.listDashboards(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/analytics/dashboards/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getDashboardDetail(ctx, id);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "dashboard not found");
    sendValidated(reply, dashboardDetailSchema, detail);
  });

  app.post("/v1/analytics/dashboards", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createDashboardBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.createDashboard(ctx, body));
  });

  app.patch("/v1/analytics/dashboards/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateDashboardBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.updateDashboard(ctx, id, body));
  });

  app.post("/v1/analytics/dashboards/:id/widgets", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = addWidgetBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.addWidget(ctx, id, body));
  });

  app.post("/v1/analytics/dashboards/:id/shares", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = shareDashboardBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.shareDashboard(ctx, id, body));
  });


  app.delete("/v1/analytics/dashboards/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    sendAccepted(reply, acceptedResponseSchema, await commands.deleteDashboard(ctx, id));
  });

  app.get("/v1/analytics/dashboards/:id/embed", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const detail = await queries.getDashboardDetail(ctx, id);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "dashboard not found");
    const EMBED_SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";
    const payload = { tenantId: ctx.tenantId, dashboardId: id, exp: Math.floor(Date.now() / 1000) + 3600 };
    const hdr = Buffer.from(JSON.stringify({ alg: "HS256", typ: "embed" })).toString("base64url");
    const pay = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", EMBED_SECRET).update(`${hdr}.${pay}`).digest("base64url");
    const token = `${hdr}.${pay}.${sig}`;
    return reply.send({ data: { embedUrl: "/embed/dashboards/" + id + "?token=" + token, expiresIn: 3600 } });
  });

  registerErrorHandler(app);
}
