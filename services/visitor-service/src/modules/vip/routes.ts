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
 *     reception on VIP arrival is implemented by `notifyVipArrival` below and
 *     wired into `modules/check-in/consumer.ts`'s check-in transaction
 *     (Requirement 21.3).
 *
 * Follows the route pattern from `modules/blacklist/routes.ts`:
 *   resolveContext → role gate → zod validate query → repo read → reply.
 */
import type { FastifyInstance } from "fastify";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import type { DrizzleTx } from "@civitasone/outbox";
import { resolveContext, HttpError } from "../../shared/context.js";
import { enqueue } from "../../shared/outbox.js";
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

/** Event type carried on the VIP-arrival NOTIFICATION_SEND payloads. */
export const VIP_ARRIVED_EVENT = "visitor.vip.arrived";
/** Role-addressed recipient for the on-duty protocol officer (Requirement 21.3). */
export const VIP_PROTOCOL_OFFICER_RECIPIENT = "protocol_officer";
/** Role-addressed recipient for the reception desk (Requirement 21.3). */
export const VIP_RECEPTION_RECIPIENT = "reception_desk";

export interface VipArrivalParams {
  tenantId: string;
  actorId: string;
  correlationId: string;
  visitorName: string;
  hostEmployeeId: string;
  locationId: string;
  passId: string;
  gateId: string;
  checkInTime: string;
}

/**
 * Requirement 21.3: on a VIP visitor's arrival, immediately alert (a) the host
 * employee, (b) the on-duty protocol officer, and (c) the reception desk.
 *
 * This is called from `modules/check-in/consumer.ts` INSIDE the same
 * `db.transaction` that records the check-in and is guarded by
 * `markProcessed(tx, msg.messageId)` — so the three NOTIFICATION_SEND messages
 * are enqueued to the transactional outbox atomically with the check-in and are
 * idempotent on redelivery (never a raw fire-and-forget `queue.publish`). The
 * outbox relay publishes them after commit; a rolled-back check-in emits nothing.
 */
export async function notifyVipArrival(tx: DrizzleTx, params: VipArrivalParams): Promise<void> {
  const variables: Record<string, string> = {
    visitorName: params.visitorName,
    passId: params.passId,
    gateId: params.gateId,
    locationId: params.locationId,
    checkInTime: params.checkInTime,
  };

  // 1. Host — immediate push (they are meeting the VIP).
  await enqueue(tx, {
    topic: NOTIFICATION_SEND,
    eventType: NOTIFICATION_SEND,
    tenantId: params.tenantId,
    actorId: params.actorId,
    correlationId: params.correlationId,
    payload: buildNotificationPayload({
      eventType: VIP_ARRIVED_EVENT,
      recipientId: params.hostEmployeeId,
      recipient: params.hostEmployeeId,
      channel: "push",
      variables,
    }),
  });

  // 2. On-duty protocol officer — push (protocol/escort handling).
  await enqueue(tx, {
    topic: NOTIFICATION_SEND,
    eventType: NOTIFICATION_SEND,
    tenantId: params.tenantId,
    actorId: params.actorId,
    correlationId: params.correlationId,
    payload: buildNotificationPayload({
      eventType: VIP_ARRIVED_EVENT,
      recipient: VIP_PROTOCOL_OFFICER_RECIPIENT,
      channel: "push",
      variables,
    }),
  });

  // 3. Reception desk — in-app (front-desk awareness).
  await enqueue(tx, {
    topic: NOTIFICATION_SEND,
    eventType: NOTIFICATION_SEND,
    tenantId: params.tenantId,
    actorId: params.actorId,
    correlationId: params.correlationId,
    payload: buildNotificationPayload({
      eventType: VIP_ARRIVED_EVENT,
      recipient: VIP_RECEPTION_RECIPIENT,
      channel: "in_app",
      variables,
    }),
  });
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
