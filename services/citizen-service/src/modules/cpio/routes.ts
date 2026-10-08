import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { listCpioQuery, createCpioBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CITIZEN_ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];
const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

/** GAP-CITIZEN-RTI-03 — CPIO / public-authority directory. */
export async function cpioRoutes(app: FastifyInstance): Promise<void> {
  // Any authenticated citizen-tier member may look up CPIOs by name/authority
  // to route an RTI; the response exposes only {id, name, designation,
  // publicAuthority, department} — no email/phone (DPDP minimisation).
  app.get("/v1/citizen/rti/cpios", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { q, limit } = listCpioQuery.parse(req.query);
    return reply.send({ data: await queries.listCpios(ctx.tenantId, q, limit) });
  });

  // Only officer-tier roles may add directory entries (server enforcement, not
  // just UI hiding).
  app.post("/v1/citizen/rti/cpios", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = createCpioBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCpio(ctx, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
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
