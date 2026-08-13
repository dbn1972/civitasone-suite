/**
 * register routes — establishment register: summary counts across estab modules.
 *
 * GET /v1/estab/register — aggregate counts of key establishment resources.
 */
import type { FastifyInstance } from "fastify";
import { sql, eq } from "drizzle-orm";
import { resolveContext, requireRole } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { estabVehicles, estabDrivers } from "../assets/schema.js";
import { estabQuarters } from "../quarters/schema.js";
import { estabOfficeRooms } from "../spaces/schema.js";
import { estabFiles } from "../files/schema.js";

const ROLES = ["estab_officer", "estab_admin", "section_officer", "super_admin", "audit_officer"];

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/estab/register", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const tid = ctx.tenantId;

    // All counts in one transaction so RLS GUC is set for all reads.
    const data = await db.transaction(async (tx) => {
      const [vehicles, drivers, quarters, rooms, files] = await Promise.all([
        tx.select({ count: sql<number>`count(*)::int` }).from(estabVehicles)
          .where(eq(estabVehicles.tenantId, tid)),
        tx.select({ count: sql<number>`count(*)::int` }).from(estabDrivers)
          .where(eq(estabDrivers.tenantId, tid)),
        tx.select({ count: sql<number>`count(*)::int` }).from(estabQuarters)
          .where(eq(estabQuarters.tenantId, tid)),
        tx.select({ count: sql<number>`count(*)::int` }).from(estabOfficeRooms)
          .where(eq(estabOfficeRooms.tenantId, tid)),
        tx.select({ count: sql<number>`count(*)::int` }).from(estabFiles)
          .where(eq(estabFiles.tenantId, tid)),
      ]);
      return {
        vehicles:    vehicles[0]?.count    ?? 0,
        drivers:     drivers[0]?.count     ?? 0,
        quarters:    quarters[0]?.count    ?? 0,
        officeRooms: rooms[0]?.count       ?? 0,
        files:       files[0]?.count       ?? 0,
        generatedAt: new Date().toISOString(),
      };
    });

    return reply.send({ data });
  });
}
