import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { validateCriteria } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin", "notification_admin"];

const criteriaSchema = z.object({
  roles: z.array(z.string().min(1)).optional(),
  departmentIds: z.array(z.string().uuid()).optional(),
  locationIds: z.array(z.string().uuid()).optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
});

const createSegmentBody = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  criteria: criteriaSchema,
});

const updateSegmentBody = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  criteria: criteriaSchema.optional(),
});

const segmentIdParam = z.object({ id: z.string().uuid() });

export async function segmentRoutes(app: FastifyInstance): Promise<void> {
  // Create a segment
  app.post("/v1/segments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createSegmentBody.parse(req.body);

    const error = validateCriteria(body.criteria);
    if (error) {
      throw new HttpError(400, "INVALID_CRITERIA", error);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createSegment(ctx, body));
  });

  // List all segments
  app.get("/v1/segments", async (req, reply) => {
    const ctx = resolveContext(req);
    const segments = await repo.listSegments(ctx.tenantId);
    return reply.send({ data: segments, meta: { total: segments.length } });
  });

  // Get a single segment
  app.get("/v1/segments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = segmentIdParam.parse(req.params);
    const segment = await repo.findSegmentById(ctx.tenantId, id);
    if (!segment) throw new HttpError(404, "NOT_FOUND", "Segment not found");
    return reply.send({ data: segment });
  });

  // Update a segment
  app.patch("/v1/segments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = segmentIdParam.parse(req.params);
    const body = updateSegmentBody.parse(req.body);

    if (body.criteria) {
      const error = validateCriteria(body.criteria);
      if (error) {
        throw new HttpError(400, "INVALID_CRITERIA", error);
      }
    }

    const existing = await repo.findSegmentById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Segment not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateSegment(ctx, id, body));
  });

  // Preview a segment (count + sample)
  app.get("/v1/segments/:id/preview", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = segmentIdParam.parse(req.params);

    const segment = await repo.findSegmentById(ctx.tenantId, id);
    if (!segment) throw new HttpError(404, "NOT_FOUND", "Segment not found");

    const preview = await repo.previewSegment(ctx.tenantId, id);
    if (preview.count === 0) {
      throw new HttpError(422, "EMPTY_SEGMENT", "Segment resolves to zero recipients — cannot send campaign");
    }

    return reply.send({ data: preview });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
