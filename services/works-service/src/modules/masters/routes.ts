import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import { publishMasterCreate, publishMasterUpdate } from "./commands.js";
import { listMaster, getMaster, searchSrItems } from "./repo.js";
import { masters } from "./registry.js";

const ADMIN_ROLES = ["works_admin", "super_admin"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function mastersRoutes(app: FastifyInstance): Promise<void> {
  // GAP-WORKS-BOQ-NEW-01: Schedule-of-Rates typeahead for the BoQ Add-item
  // picker. Registered BEFORE the generic sr-items/:id below; a static path
  // segment ("search") is matched ahead of the parametric ":id", so this never
  // collides with the master-by-id lookup.
  app.get("/v1/works/masters/sr-items/search", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { q, limit } = v.srItemSearchSchema.parse(req.query);
    const data = await searchSrItems(ctx.tenantId, q, limit);
    return reply.send({ data });
  });

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

    // PATCH update / deactivate (GAP-WORKS-MASTERS-04). Admin-only, same gate
    // as POST. Validates the row exists (404 otherwise) and that the supplied
    // version matches the current one (409 on a stale write — optimistic
    // concurrency), then publishes works.master.update; the consumer applies
    // the patch to the correct table and emits master.updated + an audit event
    // in the same transaction. Deactivation is PATCH with { active: false } —
    // masters are never hard-deleted because live records reference their ids.
    app.patch(`/v1/works/masters/${master.prefix}/:id`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, ADMIN_ROLES);
      const { id } = req.params as { id: string };
      const body = v.patchMasterSchema.parse(req.body);
      const existing = await getMaster(master.table, ctx.tenantId, id);
      if (!existing) throw new HttpError(404, "NOT_FOUND", `${master.prefix} not found`);
      const current = (existing as { version?: number }).version ?? 1;
      if (current !== body.version) {
        throw new HttpError(409, "VERSION_CONFLICT", `this record changed since you loaded it (expected version ${current})`);
      }
      const { version: _version, ...patch } = body;
      void _version;
      return sendAccepted(reply, acceptedResponseSchema, await publishMasterUpdate(ctx, master.prefix, id, patch));
    });
  }
}
