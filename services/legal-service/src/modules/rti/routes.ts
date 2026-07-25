import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  idParam, appealIdParam, createRtiBody, transferRtiBody, thirdPartyConsultBody,
  additionalFeeBody, respondRtiBody, fileAppealBody, appealOrderBody, disclosureBody,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

// PIO / RTI cell can process; the appellate authority is a separate role
// (the maker-checker guard in the consumer additionally enforces that the
// actor deciding an appeal differs from the one who filed it).
const PIO_ROLES        = ["legal_officer", "legal_admin", "rti_pio", "super_admin"];
const APPELLATE_ROLES  = ["legal_admin", "rti_appellate", "super_admin"];
const READER_ROLES     = [...PIO_ROLES, "audit_officer"];

export async function rtiRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/legal/rti/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PIO_ROLES);
    const body = createRtiBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createApplication(ctx, body));
  });

  app.get("/v1/legal/rti/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listApplications(ctx.tenantId, q.limit));
  });

  app.get("/v1/legal/rti/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const found = await queries.getApplication(ctx.tenantId, id);
    if (!found) throw new HttpError(404, "NOT_FOUND", "rti application not found");
    return reply.send(found);
  });

  app.post("/v1/legal/rti/applications/:id/transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PIO_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transferRtiBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.transferApplication(ctx, id, body));
  });

  app.post("/v1/legal/rti/applications/:id/third-party-consult", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PIO_ROLES);
    const { id } = idParam.parse(req.params);
    const body = thirdPartyConsultBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.startThirdPartyConsult(ctx, id, body));
  });

  app.post("/v1/legal/rti/applications/:id/additional-fee", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PIO_ROLES);
    const { id } = idParam.parse(req.params);
    const body = additionalFeeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.levyAdditionalFee(ctx, id, body));
  });

  app.post("/v1/legal/rti/applications/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PIO_ROLES);
    const { id } = idParam.parse(req.params);
    const body = respondRtiBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.respond(ctx, id, body));
  });

  app.post("/v1/legal/rti/applications/:id/appeals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PIO_ROLES);
    const { id } = idParam.parse(req.params);
    const body = fileAppealBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.fileAppeal(ctx, id, body));
  });

  // Maker-checker: only the appellate authority passes the order.
  app.post("/v1/legal/rti/applications/:id/appeals/:appealId/order", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPELLATE_ROLES);
    const { appealId } = appealIdParam.parse(req.params);
    const body = appealOrderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.decideAppeal(ctx, appealId, body));
  });

  app.get("/v1/legal/rti/disclosures", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listDisclosures(ctx.tenantId, q.limit));
  });

  app.post("/v1/legal/rti/disclosures", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PIO_ROLES);
    const body = disclosureBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.logDisclosure(ctx, null, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
