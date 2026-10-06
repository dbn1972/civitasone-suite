import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { causeListIdParam, createCauseListBody, listCaseBody, lookupCauseListQuery } from "./validators.js";
import { deriveCauseListId } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const CAUSELIST_WRITE_ROLES = ["registrar", "court_admin", "super_admin"];
const CAUSELIST_READ_ROLES = ["registrar", "court_admin", "judge", "court_clerk", "super_admin"];

export async function causeListRoutes(app: FastifyInstance): Promise<void> {
  // Generate (materialize) a cause-list for a court/day.
  app.post("/v1/court/cause-lists", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CAUSELIST_WRITE_ROLES);
    const body = createCauseListBody.parse(req.body);
    const result = await commands.createCauseList(ctx, body);
    return reply.code(202).send(result);
  });

  // Look up an EXISTING cause-list for a court on a date (GAP-COURT-CAUSE-LIST-02).
  // A court has exactly one cause-list per date (deterministic id), so this lets
  // the UI re-open a day's list after reload and avoid a duplicate "generate".
  app.get("/v1/court/cause-lists", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CAUSELIST_READ_ROLES);
    const q = lookupCauseListQuery.parse(req.query);
    const id = deriveCauseListId(ctx.tenantId, q.courtId, q.listDate);
    const found = await repo.getCauseList(ctx.tenantId, id);
    return reply.send({ causeList: found ?? null, exists: Boolean(found), source: "db" });
  });

  // List a case onto a slot/courtroom of a cause-list.
  app.post("/v1/court/cause-lists/:id/items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CAUSELIST_WRITE_ROLES);
    const { id } = causeListIdParam.parse(req.params);
    const body = listCaseBody.parse(req.body);
    const result = await commands.listCaseOnCauseList(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List the items of a cause-list.
  app.get("/v1/court/cause-lists/:id/items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CAUSELIST_READ_ROLES);
    const { id } = causeListIdParam.parse(req.params);
    const items = await repo.listItems(ctx.tenantId, id);
    return reply.send({ items, count: items.length, source: "db" });
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "cause-list route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
