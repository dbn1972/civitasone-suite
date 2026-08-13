import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { pincodeParam, pincodeSearchQuery, bulkImportBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const PINCODE_ROLES = ["location_user", "location_admin", "super_admin", "admin"];

export async function pincodeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/pincodes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PINCODE_ROLES);
    const rawQ = (req.query as Record<string, string>).q ?? "";
    // If q provided use search; otherwise return an empty data set with a hint.
    const results = rawQ.length >= 1 ? await repo.search(rawQ) : [];
    return reply.send({ data: results, hint: rawQ ? undefined : "Pass ?q= to search pincodes" });
  });

  app.get("/v1/pincodes/:code", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PINCODE_ROLES);
    const { code } = pincodeParam.parse(req.params);
    const results = await repo.findByPincode(code);
    if (results.length === 0) throw new HttpError(404, "NOT_FOUND", `no records found for PIN code ${code}`);
    return reply.send({ data: results });
  });

  app.get("/v1/pincodes/search", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PINCODE_ROLES);
    const { q } = pincodeSearchQuery.parse(req.query);
    const results = await repo.search(q);
    return reply.send({ data: results });
  });

  app.post("/v1/pincodes/bulk-import", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["location_admin", "super_admin", "admin"]);
    const body = bulkImportBody.parse(req.body);
    return reply.code(202).send(await commands.pincodeBulkImport(ctx, body));
  });
}
