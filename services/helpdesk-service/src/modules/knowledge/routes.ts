import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

const HELPDESK_ROLES = ["helpdesk_user", "helpdesk_admin", "super_admin"];

const ticketIdParam = z.object({ ticketId: z.string().uuid() });
const unlinkParams = z.object({ ticketId: z.string().uuid(), articleId: z.string().uuid() });

const linkBody = z.object({
  articleId: z.string().uuid(),
  articleTitle: z.string().min(1).max(200),
});

const searchQuery = z.object({
  q: z.string().min(1),
});

/** Knowledge-service base URL (same host, different port in dev). */
const KNOWLEDGE_BASE_URL = process.env.KNOWLEDGE_SERVICE_URL ?? "http://localhost:3028";

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  /** CS-004: Link a knowledge article to a ticket. */
  app.post("/v1/helpdesk/tickets/:ticketId/knowledge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { ticketId } = ticketIdParam.parse(req.params);
    const body = linkBody.parse(req.body);

    // Verify ticket exists for this tenant
    const exists = await repo.ticketExists(ctx.tenantId, ticketId);
    if (!exists) {
      throw new HttpError(404, "TICKET_NOT_FOUND", "Ticket not found");
    }

    const { data, created } = await repo.insertLink({
      tenantId: ctx.tenantId,
      ticketId,
      articleId: body.articleId,
      articleTitle: body.articleTitle,
      linkedBy: ctx.actorId,
    });

    return reply.code(created ? 201 : 200).send({ data });
  });

  /** CS-004: List knowledge articles linked to a ticket. */
  app.get("/v1/helpdesk/tickets/:ticketId/knowledge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { ticketId } = ticketIdParam.parse(req.params);

    const rows = await repo.listLinks(ctx.tenantId, ticketId);
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  /** CS-004: Unlink a knowledge article from a ticket. */
  app.delete("/v1/helpdesk/tickets/:ticketId/knowledge/:articleId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { ticketId, articleId } = unlinkParams.parse(req.params);

    const deleted = await repo.deleteLink(ctx.tenantId, ticketId, articleId);
    if (!deleted) {
      throw new HttpError(404, "LINK_NOT_FOUND", "Knowledge link not found");
    }

    return reply.code(204).send();
  });

  /** CS-004: Proxy search to knowledge-service. */
  app.get("/v1/helpdesk/knowledge/search", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HELPDESK_ROLES);
    const { q } = searchQuery.parse(req.query);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const url = `${KNOWLEDGE_BASE_URL}/v1/knowledge/search?q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          authorization: req.headers.authorization ?? "",
          "x-tenant-id": ctx.tenantId,
          "x-correlation-id": ctx.correlationId,
        },
      });

      if (!res.ok) {
        const body = await res.text();
        return reply.code(res.status).send({ error: { code: "KNOWLEDGE_SEARCH_ERROR", message: body } });
      }

      const body: unknown = await res.json();
      return reply.send(body);
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const isNetwork = err instanceof TypeError;
      if (isAbort || isNetwork) {
        req.log.warn({ err }, "knowledge-service unavailable");
        throw new HttpError(503, "KNOWLEDGE_SERVICE_UNAVAILABLE", "Knowledge service is unavailable");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
