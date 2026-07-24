import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as v from "./validators.js";
import { listMaster, getMaster } from "./repo.js";
import * as s from "./schema.js";

const ADMIN_ROLES = ["works_admin", "super_admin"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

type MasterConfig = {
  table: Parameters<typeof listMaster>[0];
  prefix: string;
  createSchema: ReturnType<typeof import("zod").z.object>;
};

const masters: MasterConfig[] = [
  { table: s.authorities, prefix: "authorities", createSchema: v.createAuthoritySchema },
  { table: s.workTypes, prefix: "work-types", createSchema: v.createWorkTypeSchema },
  { table: s.workSubTypes, prefix: "work-sub-types", createSchema: v.createWorkSubTypeSchema },
  { table: s.proposerTypes, prefix: "proposer-types", createSchema: v.createMasterSchema },
  { table: s.programs, prefix: "programs", createSchema: v.createMasterSchema },
  { table: s.publicationLevels, prefix: "publication-levels", createSchema: v.createMasterSchema },
  { table: s.repairTypes, prefix: "repair-types", createSchema: v.createRepairTypeSchema },
  { table: s.schemes, prefix: "schemes", createSchema: v.createSchemeSchema },
  { table: s.scopes, prefix: "scopes", createSchema: v.createScopeSchema },
  { table: s.tenderTypes, prefix: "tender-types", createSchema: v.createTenderTypeSchema },
  { table: s.userDepartments, prefix: "user-departments", createSchema: v.createMasterSchema },
  { table: s.contractorClasses, prefix: "contractor-classes", createSchema: v.createMasterSchema },
  { table: s.issueTypes, prefix: "issue-types", createSchema: v.createMasterSchema },
  { table: s.issueDescriptionTypes, prefix: "issue-description-types", createSchema: v.createMasterSchema },
  { table: s.assets, prefix: "assets", createSchema: v.createAssetSchema },
  { table: s.workDescriptionTypes, prefix: "work-description-types", createSchema: v.createMasterSchema },
  { table: s.srItems, prefix: "sr-items", createSchema: v.createSrItemSchema },
];

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

    // POST create
    app.post(`/v1/works/masters/${master.prefix}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, ADMIN_ROLES);
      const body = master.createSchema.parse(req.body);
      const id = randomUUID();
      await queue.publish(COMMANDS.proposalCreate, {
        messageId: randomUUID(),
        type: `works.master.${master.prefix}.create`,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        schemaVersion: "1.0",
        payload: { id, ...body },
      });
      return reply.status(202).send({ id, status: "accepted" });
    });
  }
}
