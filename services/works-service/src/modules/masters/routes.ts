import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import { publishMasterCreate } from "./commands.js";
import { listMaster, getMaster } from "./repo.js";
import { masters } from "./registry.js";

const ADMIN_ROLES = ["works_admin", "super_admin"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function mastersRoutes(app: FastifyInstance): Promise<void> {
  for (const master of masters) {
    // GET list
    app.get(`/v1/works/masters/${master.prefix}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, READ_ROLES);
      const query = v.paginationSchema.parse(req.query);
      const data = (await listMaster(master.table, ctx.tenantId, query.page, query.pageSize)) ?? [];
      return reply.send({ data, meta: { page: query.page, pageSize: query.pageSize, total: data.length } });
    });

    // GET by id
    app.get(`/v1/works/masters/${master.prefix}/:id`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, READ_ROLES);
      const { id } = req.params as { id: string };
      const row = await getMaster(master.table, ctx.tenantId, id);
      if (!row) throw new HttpError(404, "NOT_FOUND", `${master.prefix} not found`);
      return reply.send({ data: row });
    });

    // POST create — publishes a CQRS command (works.master.create). The
    // masters consumer resolves master.prefix -> table via the SAME registry
    // used here, and persists it there. NEVER publish this to proposalCreate —
    // that was the CRITICAL bug this fixes (masters silently became proposals).
    app.post(`/v1/works/masters/${master.prefix}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, ADMIN_ROLES);
      const body = master.createSchema.parse(req.body);
      return sendAccepted(reply, acceptedResponseSchema, await publishMasterCreate(ctx, master.prefix, body));
    });
  }
}
