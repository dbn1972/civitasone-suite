import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  ENGINE_REGISTRY,
  enginesForBlock,
  normalizeEngineBindings,
  previewEngineDemand,
  type EngineBinding,
} from "./domain.js";
import { engineBlockQuery, enginePreviewBody } from "./validators.js";

const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

export async function engineBindingRoutes(app: FastifyInstance): Promise<void> {
  /** Registry of bindable engines + config schemas for the Designer picker. */
  app.get("/v1/citizen/engines", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const q = engineBlockQuery.parse(req.query ?? {});
    const data = q.block ? enginesForBlock(q.block) : ENGINE_REGISTRY;
    return reply.send({ data });
  });

  /**
   * Studio sample calculation — applies binding parameters to a principal.
   * Does not invent assessment logic; assessment compute stays in the engine.
   */
  app.post("/v1/citizen/engines/preview", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = enginePreviewBody.parse(req.body);
    const [binding] = normalizeEngineBindings([body.binding]);
    if (!binding) {
      throw new HttpError(400, "INVALID_BINDING", "engine binding is invalid");
    }
    const result = previewEngineDemand({
      binding: binding as EngineBinding,
      basePrincipalMinor: body.basePrincipalMinor,
      selectedExemptions: body.selectedExemptions,
      applyRebate: body.applyRebate,
      applyPenalty: body.applyPenalty,
    });
    return reply.send(result);
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
      return reply.code(err.status).send({
        code: err.code,
        message: err.message,
        correlationId,
        retryable: false,
      });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({
      code: "INTERNAL",
      message: "internal error",
      correlationId,
      retryable: true,
    });
  });
}
