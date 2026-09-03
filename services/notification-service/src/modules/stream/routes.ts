import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { pino } from "pino";
import { resolveContext, HttpError } from "../../shared/context.js";
import { createStreamSubscriber, type StreamSubscriber } from "./subscriber.js";
import * as repo from "./repo.js";

const log = pino({ name: "stream:sse" });

/** 30 minutes idle timeout in milliseconds */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Heartbeat interval — 25s to keep connections alive through proxies */
const HEARTBEAT_INTERVAL_MS = 25_000;

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  /**
   * SSE endpoint: GET /v1/notifications/stream
   * Authenticated, tenant-scoped per user.
   * On connect: sends unread persisted notifications, then streams new ones via Redis pub/sub.
   * Auto-closes after 30min idle.
   */
  app.get("/notifications/stream", async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    const { tenantId, actorId } = ctx;
    const channel = `notifications:${tenantId}:${actorId}`;

    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    });

    // Send initial connected event
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ channel, userId: actorId })}\n\n`);

    // Replay unread notifications
    try {
      const unread = await repo.listUnread(tenantId, actorId);
      for (const n of unread) {
        const payload = {
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          metadata: n.metadata,
          createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : String(n.createdAt),
        };
        reply.raw.write(`event: notification\ndata: ${JSON.stringify(payload)}\n\n`);
      }
    } catch (err) {
      log.warn({ err, tenantId, actorId }, "failed to replay unread notifications");
    }

    // Subscribe to Redis pub/sub for real-time notifications
    let subscriber: StreamSubscriber | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const resetIdleTimer = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        log.info({ tenantId, actorId }, "SSE connection idle timeout (30min)");
        cleanup();
      }, IDLE_TIMEOUT_MS);
    };

    const cleanup = (): void => {
      if (subscriber) {
        subscriber.unsubscribe().catch((err) => {
          log.warn({ err }, "error unsubscribing from Redis");
        });
        subscriber = null;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (!reply.raw.destroyed) {
        reply.raw.end();
      }
    };

    try {
      subscriber = await createStreamSubscriber(channel, (message: string) => {
        if (reply.raw.destroyed) {
          cleanup();
          return;
        }
        resetIdleTimer();
        reply.raw.write(`event: notification\ndata: ${message}\n\n`);
      });
    } catch (err) {
      log.error({ err, tenantId, actorId }, "failed to create Redis subscriber");
      // Still keep the SSE connection open — notifications will come via polling fallback
    }

    // Heartbeat to keep connection alive
    heartbeatTimer = setInterval(() => {
      if (reply.raw.destroyed) {
        cleanup();
        return;
      }
      reply.raw.write(`:heartbeat\n\n`);
    }, HEARTBEAT_INTERVAL_MS);

    // Start idle timer
    resetIdleTimer();

    // Handle client disconnect
    req.raw.on("close", () => {
      log.info({ tenantId, actorId }, "SSE client disconnected");
      cleanup();
    });

    // Prevent Fastify from sending a response — we're handling the raw stream
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    reply.hijack();
  });

  /**
   * POST /v1/notifications/publish — Publish a notification to a user.
   * Used internally by consumers to push notifications in real-time.
   * Persists notification for offline delivery and publishes via Redis pub/sub.
   */
  app.post("/notifications/publish", async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    const body = req.body as {
      userId: string;
      type: string;
      title: string;
      body?: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.userId || !body.type || !body.title) {
      throw new HttpError(400, "VALIDATION_FAILED", "userId, type, and title are required");
    }

    // Persist notification for offline recipients
    const notification = await repo.persistNotification({
      tenantId: ctx.tenantId,
      userId: body.userId,
      type: body.type,
      title: body.title,
      body: body.body ?? "",
      metadata: body.metadata ?? {},
      createdBy: ctx.actorId,
    });

    // Publish via Redis pub/sub for real-time delivery
    const { createNotificationPublisher } = await import("../../adapters/pubsub.js");
    const publisher = createNotificationPublisher();
    const channel = `notifications:${ctx.tenantId}:${body.userId}`;
    const payload = {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      metadata: notification.metadata,
      createdAt: notification.createdAt instanceof Date ? notification.createdAt.toISOString() : String(notification.createdAt),
    };

    await publisher.publish(channel, payload);

    return reply.code(202).send({ data: { id: notification.id } });
  });

  /**
   * POST /v1/notifications/stream/mark-read — Mark notification(s) as read.
   */
  app.post("/notifications/stream/mark-read", async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    const body = req.body as { notificationId?: string; all?: boolean };

    if (body.all) {
      const count = await repo.markAllRead(ctx.tenantId, ctx.actorId);
      return reply.code(200).send({ data: { marked: count } });
    }

    if (!body.notificationId) {
      throw new HttpError(400, "VALIDATION_FAILED", "notificationId or all:true is required");
    }

    const success = await repo.markRead(ctx.tenantId, ctx.actorId, body.notificationId);
    if (!success) {
      throw new HttpError(404, "NOT_FOUND", "notification not found or already read");
    }

    return reply.code(200).send({ data: { marked: 1 } });
  });
  /**
   * GET /notifications/stream/unread — list recent unread notifications for the bell dropdown.
   * Supports ?limit=N (default 20, max 50).
   */
  app.get("/notifications/stream/unread", async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req);
    const { tenantId, actorId } = ctx;
    const query = (req.query as Record<string, string | undefined>);
    const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? "20", 10) || 20));
    const rows = await repo.listUnread(tenantId, actorId, limit);
    const data = rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      metadata: n.metadata,
      createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : String(n.createdAt),
      readAt: n.readAt ? (n.readAt instanceof Date ? n.readAt.toISOString() : String(n.readAt)) : null,
    }));
    return reply.code(200).send({ data });
  });

}
