import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import {
  createFaqBody,
  updateFaqBody,
  createFlowBody,
  updateFlowBody,
  askBody,
  escalateBody,
  metricsQuery,
  listFaqQuery,
} from "./validators.js";

const ROLES = ["knowledge_user", "knowledge_admin", "super_admin"];
const ADMIN_ROLES = ["knowledge_admin", "super_admin"];

export async function assistantRoutes(app: FastifyInstance): Promise<void> {
  // ── FAQ store ──────────────────────────────────────────────────
  app.get("/v1/knowledge/faqs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listFaqQuery.parse(req.query);
    return reply.send(await queries.listFaqs(ctx.tenantId, q.category, q.limit, q.offset));
  });

  app.get("/v1/knowledge/faqs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const faq = await queries.getFaq(ctx.tenantId, id);
    if (!faq) throw new HttpError(404, "NOT_FOUND", "faq not found");
    return reply.send(faq);
  });

  app.post("/v1/knowledge/faqs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createFaqBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createFaq(ctx, body));
  });

  app.put("/v1/knowledge/faqs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = req.params as { id: string };
    const body = updateFaqBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateFaq(ctx, id, body));
  });

  app.delete("/v1/knowledge/faqs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = req.params as { id: string };
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteFaq(ctx, id));
  });

  // ── Guided support flows ───────────────────────────────────────
  app.get("/v1/knowledge/guided-flows", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    return reply.send(await queries.listFlows(ctx.tenantId));
  });

  app.get("/v1/knowledge/guided-flows/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = req.params as { id: string };
    const flow = await queries.getFlow(ctx.tenantId, id);
    if (!flow) throw new HttpError(404, "NOT_FOUND", "guided flow not found");
    return reply.send(flow);
  });

  app.post("/v1/knowledge/guided-flows", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createFlowBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createFlow(ctx, body));
  });

  app.put("/v1/knowledge/guided-flows/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = req.params as { id: string };
    const body = updateFlowBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateFlow(ctx, id, body));
  });

  // ── Virtual assistant ──────────────────────────────────────────
  app.post("/v1/knowledge/assistant/ask", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = askBody.parse(req.body);
    const result = await commands.ask(ctx, body);
    return reply.code(200).send({ data: result });
  });

  app.post("/v1/knowledge/assistant/escalate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = escalateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.escalate(ctx, body));
  });

  app.get("/v1/knowledge/assistant/metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = metricsQuery.parse(req.query);
    return reply.send(await queries.metrics(ctx.tenantId, q.from, q.to));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
