/**
 * G6 — Unified Customer Timeline (cross-service aggregation).
 *
 * Aggregates CRM-local data (activities, communications) with cross-service
 * data from notification-service (deliveries, inbox) and telephony-service (calls).
 *
 * Uses Promise.allSettled for graceful degradation — one service being down
 * never blocks the timeline or causes a 500.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const paramsSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Standard timeline item shape returned to the client. */
export interface TimelineItem {
  id: string;
  type: "activity" | "communication" | "delivery" | "call" | "conversation";
  timestamp: string;
  summary: string;
  source: "crm" | "notification" | "telephony";
  metadata: Record<string, unknown>;
}

interface ServiceResult {
  source: "notification" | "telephony";
  status: "ok" | "unavailable";
  data: TimelineItem[];
}

const NOTIFICATION_BASE = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3006";
const TELEPHONY_BASE = process.env.TELEPHONY_SERVICE_URL ?? "http://localhost:3026";
const FETCH_TIMEOUT_MS = 10_000;

type Rows = Array<Record<string, unknown>>;

/**
 * Fetch from an external service with a 5s timeout. Returns null on any failure.
 */
async function fetchExternal(
  url: string,
  headers: Record<string, string>,
): Promise<unknown[] | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    // Support both { data: [...] } envelope and raw array
    if (Array.isArray(body)) return body;
    if (body && typeof body === "object" && "data" in body && Array.isArray((body as Record<string, unknown>).data)) {
      return (body as Record<string, unknown>).data as unknown[];
    }
    return [];
  } catch {
    return null;
  }
}

/** Map notification-service delivery records to timeline items. */
function mapDeliveries(raw: unknown[]): TimelineItem[] {
  return raw.map((r: unknown) => {
    const d = r as Record<string, unknown>;
    return {
      id: String(d.id ?? d.deliveryId ?? ""),
      type: "delivery" as const,
      timestamp: String(d.sentAt ?? d.createdAt ?? d.timestamp ?? ""),
      summary: `${String(d.channel ?? "message")} ${String(d.status ?? "sent")}${d.subject ? `: ${d.subject}` : ""}`,
      source: "notification" as const,
      metadata: d,
    };
  });
}

/** Map telephony-service call records to timeline items. */
function mapCalls(raw: unknown[]): TimelineItem[] {
  return raw.map((r: unknown) => {
    const c = r as Record<string, unknown>;
    return {
      id: String(c.id ?? c.callId ?? ""),
      type: "call" as const,
      timestamp: String(c.startedAt ?? c.createdAt ?? c.timestamp ?? ""),
      summary: `${String(c.direction ?? "call")} call — ${String(c.status ?? c.outcome ?? "completed")}${c.duration ? ` (${c.duration}s)` : ""}`,
      source: "telephony" as const,
      metadata: c,
    };
  });
}

/** Map notification-service inbox/conversations to timeline items. */
function mapConversations(raw: unknown[]): TimelineItem[] {
  return raw.map((r: unknown) => {
    const cv = r as Record<string, unknown>;
    return {
      id: String(cv.id ?? cv.conversationId ?? ""),
      type: "conversation" as const,
      timestamp: String(cv.lastMessageAt ?? cv.updatedAt ?? cv.createdAt ?? cv.timestamp ?? ""),
      summary: `${String(cv.channel ?? "conversation")}${cv.subject ? `: ${cv.subject}` : ""}${cv.messageCount ? ` (${cv.messageCount} messages)` : ""}`,
      source: "notification" as const,
      metadata: cv,
    };
  });
}

export async function timelineRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/contacts/:id/timeline", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = paramsSchema.parse(req.params);
    const { limit, offset } = querySchema.parse(req.query);
    const t = ctx.tenantId;

    // 1. Verify contact exists (tenant-scoped)
    const contactExists = await scopedRead(async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT id FROM crm.contacts WHERE id = ${id} AND tenant_id = ${t} LIMIT 1
      `)) as unknown as Rows;
      return rows.length > 0;
    });

    if (!contactExists) {
      throw new HttpError(404, "NOT_FOUND", "contact not found");
    }

    // 2. Fetch CRM-local timeline data
    const crmItems = await scopedRead(async (tx) => {
      const activities = (await tx.execute(sql`
        SELECT id, type, subject, status, created_at AS "createdAt"
        FROM crm.activities WHERE tenant_id = ${t} AND contact_id = ${id}
        ORDER BY created_at DESC LIMIT 100
      `)) as unknown as Rows;

      const communications = (await tx.execute(sql`
        SELECT id, direction, channel, outcome, summary, occurred_at AS "occurredAt"
        FROM crm.communications WHERE tenant_id = ${t} AND subject_type = 'contact' AND subject_id = ${id}
        ORDER BY occurred_at DESC LIMIT 100
      `)) as unknown as Rows;

      const activityItems: TimelineItem[] = activities.map((a) => ({
        id: String(a.id),
        type: "activity" as const,
        timestamp: String(a.createdAt ?? ""),
        summary: `${String(a.type ?? "activity")}: ${String(a.subject ?? "")} [${String(a.status ?? "")}]`,
        source: "crm" as const,
        metadata: a,
      }));

      const commItems: TimelineItem[] = communications.map((c) => ({
        id: String(c.id),
        type: "communication" as const,
        timestamp: String(c.occurredAt ?? ""),
        summary: `${String(c.direction ?? "")} ${String(c.channel ?? "")}${c.summary ? `: ${c.summary}` : ""}`,
        source: "crm" as const,
        metadata: c,
      }));

      return [...activityItems, ...commItems];
    });

    // 3. Fetch cross-service data in parallel with graceful degradation
    const authHeader = req.headers.authorization ?? "";
    const downstreamHeaders: Record<string, string> = {
      "x-tenant-id": t,
      authorization: authHeader,
      "content-type": "application/json",
    };

    const [deliveriesResult, callsResult, conversationsResult] = await Promise.allSettled([
      fetchExternal(
        `${NOTIFICATION_BASE}/notifications/deliveries?recipientId=${id}`,
        downstreamHeaders,
      ),
      fetchExternal(
        `${TELEPHONY_BASE}/v1/telephony/calls?contactId=${id}`,
        downstreamHeaders,
      ),
      fetchExternal(
        `${NOTIFICATION_BASE}/notifications/inbox?contactId=${id}`,
        downstreamHeaders,
      ),
    ]);

    const serviceStatus: ServiceResult[] = [];
    let crossServiceItems: TimelineItem[] = [];

    // Process notification-service deliveries
    const deliveriesRaw =
      deliveriesResult.status === "fulfilled" ? deliveriesResult.value : null;
    if (deliveriesRaw) {
      const items = mapDeliveries(deliveriesRaw);
      crossServiceItems = crossServiceItems.concat(items);
    } else {
      serviceStatus.push({ source: "notification", status: "unavailable", data: [] });
    }

    // Process telephony-service calls
    const callsRaw = callsResult.status === "fulfilled" ? callsResult.value : null;
    if (callsRaw) {
      const items = mapCalls(callsRaw);
      crossServiceItems = crossServiceItems.concat(items);
    } else {
      serviceStatus.push({ source: "telephony", status: "unavailable", data: [] });
    }

    // Process notification-service conversations
    const conversationsRaw =
      conversationsResult.status === "fulfilled" ? conversationsResult.value : null;
    if (conversationsRaw) {
      const items = mapConversations(conversationsRaw);
      crossServiceItems = crossServiceItems.concat(items);
    }
    // If conversations fail but deliveries succeeded, don't duplicate notification unavailable
    if (!conversationsRaw && !deliveriesRaw) {
      // Already marked notification as unavailable above
    } else if (!conversationsRaw && deliveriesRaw) {
      // Partial failure on notification: conversations down but deliveries up — still note it
      // We don't add a second unavailable entry since deliveries already worked
    }

    // 4. Merge and sort chronologically (most recent first)
    const allItems = [...crmItems, ...crossServiceItems].sort((a, b) => {
      const ta = new Date(a.timestamp).getTime() || 0;
      const tb = new Date(b.timestamp).getTime() || 0;
      return tb - ta;
    });

    // 5. Paginate
    const paginated = allItems.slice(offset, offset + limit);

    return reply.send({
      data: paginated,
      meta: {
        total: allItems.length,
        limit,
        offset,
        hasMore: offset + limit < allItems.length,
      },
      services: serviceStatus.length > 0 ? serviceStatus : undefined,
    });
  });
}
