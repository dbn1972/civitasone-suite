import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { idParam } from "../catalogue/validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import * as catalogueRepo from "../catalogue/repo.js";
import { isRunCurrent } from "./commands.js";

const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

export async function sandboxTestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/catalogue/services/:id/sandbox-test/run", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await commands.runSandboxTest(ctx, id));
  });

  app.get("/v1/citizen/catalogue/services/:id/sandbox-test/runs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const runs = await repo.listRunsForDefinition(ctx.tenantId, id, 10);
    return reply.send({ data: runs });
  });

  app.get("/v1/citizen/catalogue/services/:id/sandbox-test/latest", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const latest = await repo.latestRunForDefinition(ctx.tenantId, id);
    if (!latest) return reply.send({ status: "none" });
    // `stale`: the run tested an earlier design than the draft has now, so it no
    // longer authorises submit (see assertLatestTestPassed).
    const def = await catalogueRepo.findDefinitionById(id, ctx.tenantId);
    return reply.send({ ...latest, stale: def ? !isRunCurrent(latest.definitionHash, def) : true });
  });
}
