import type { FastifyInstance } from "fastify";
import { listQuerySchema } from "@civitasone/schemas/common";
import { AppraisalSummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as queries from "./queries.js";

const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

export async function appraisalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/appraisals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, AppraisalSummaryListSchema, await queries.listAppraisals(ctx.tenantId, q.limit));
  });
}
