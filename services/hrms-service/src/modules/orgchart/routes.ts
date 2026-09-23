import type { FastifyInstance } from "fastify";
import { OrgChartSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as queries from "./queries.js";

// "employee" added deliberately (HRMS role-based review, Problem B): an org
// chart is ordinary, low-sensitivity lookup information -- name, designation,
// department, reporting line (see orgchart/queries.ts's OrgNode shape; no
// PII, no salary) -- that every employee in a real office needs to look up,
// not something that needs HR-admin gating. Confirmed live that a plain
// "employee" role was blocked here (Couldn't load — showing nothing) even
// though hr/layout.tsx already admits that role into the /hr/org-chart page
// that renders this exact data. This route has no other consumer to worry
// about widening (org-chart/routes.ts defines only this one endpoint).
const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager", "employee"];

export async function orgChartRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/org-chart", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    sendValidated(reply, OrgChartSchema, await queries.getOrgChart(ctx.tenantId));
  });
}
