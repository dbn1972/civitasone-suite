import type { FastifyInstance } from "fastify";
import { OrgChartSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as queries from "./queries.js";

const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

export async function orgChartRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/org-chart", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    sendValidated(reply, OrgChartSchema, await queries.getOrgChart(ctx.tenantId));
  });
}
