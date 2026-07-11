/**
 * visitor-service: VIP module routes.
 *
 * Owns:
 *   - `GET /v1/visitor/vip/log` — returns visit requests with
 *     visitor_category = "vip", restricted to `protocol_officer` and
 *     `security_admin` roles (Requirements 21.4, 21.5).
 *
 * VIP wiring into other modules:
 *   - Visit-request creation path: host-confirmation bypass is already
 *     handled in `modules/visit-request/domain.ts` via `resolveInitialStatus`
 *     (Property 27 / Requirement 21.2). No additional hook needed here.
 *   - Check-in consumer: immediate alert to host + protocol officer +
 *     reception on VIP arrival is documented as a TODO below and will be
 *     wired into `modules/check-in/consumer.ts` when Task 9.10 is
 *     executed (Requirement 21.3).
 *
 * Follows the route pattern from `modules/blacklist/routes.ts`:
 *   resolveContext → role gate → zod validate query → repo read → reply.
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, HttpError } from "../../shared/context.js";
import { assertCanViewVipLog } from "./domain.js";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { visitRequests } from "../visit-request/schema.js";

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const listVipLogQuery = z.object({
  locationId: z.string().uuid("invalid locationId").optional(),
});

// ---------------------------------------------------------------------------
// VIP wiring hooks (lightweight callables for other modules)
// ---------------------------------------------------------------------------

/**
 * TODO (Task 9.10 / Requirement 21.3): call this function from
 * `modules/check-in/consumer.ts` after a VIP check-in is committed.
 * It should publish NOTIFICATION_SEND payloads to:
 *   1. The host employee (push + in-app)
 *   2. The protocol officer on duty
 *   3. Reception desk
 *
 * Signature is intentionally minimal — expand once the check-in consumer
 * is fully wired (Task 9.10).
 */
export async function notifyVipArrival(_params: {
  tenantId: string;
  visitorName: string;
  hostEmployeeId: string;
  locationId: string;
  passId: string;
  gateId: string;
}): Promise<void> {
  // TODO: Implement VIP arrival notification (Requirement 21.3)
  // 1. Build NOTIFICATION_SEND payload for host (immediate push + in-app)
  // 2. Build NOTIFICATION_SEND payload for protocol_officer on duty
  // 3. Build NOTIFICATION_SEND payload for reception desk
  // 4. Publish all three via outbox or direct queue.publish
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function vipRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/visitor/vip/log
   *
   * Returns all visit requests where visitor_category = "vip" for the
   * caller's tenant. Role-gated to protocol_officer / security_admin
   * via domain.ts's assertCanViewVipLog (Requirement 21.4, 21.5).
   */
  app.get("/v1/visitor/vip/log", async (req, reply) => {
    const ctx = resolveContext(req);

    // Role gate: throws DomainError (mapped to 403) if caller lacks
    // protocol_officer or security_admin.
    try {
      assertCanViewVipLog(ctx.roles);
    } catch {
      throw new HttpError(403, "FORBIDDEN", "VIP log access requires protocol_officer or security_admin role");
    }

    const query = listVipLogQuery.parse(req.query);

    const conditions = [
      eq(visitRequests.tenantId, ctx.tenantId),
      eq(visitRequests.visitorCategory, "vip"),
    ];
    if (query.locationId !== undefined) {
      conditions.push(eq(visitRequests.locationId, query.locationId));
    }

    const rows = await scopedRead((tx) => tx
      .select()
      .from(visitRequests)
      .where(and(...conditions)));

    return reply.send({ data: rows });
  });
}
