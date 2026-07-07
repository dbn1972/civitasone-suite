import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { vendorListResponseSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createVendorBody, empanelBody, blacklistBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import type { RequestContext } from "@civitasone/types";

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer"];

/** Roles authorized to view decrypted PII fields on vendor records. */
export const PII_AUTHORIZED_ROLES = [
  "procurement_officer",
  "procurement_admin",
  "finance_officer",
  "tenant_admin",
  "super_admin",
  "audit_officer",
] as const;

/** Remove PII fields from a vendor record. */
export function stripPii<T extends Record<string, unknown>>(vendor: T): Omit<T, "pan" | "email" | "phone" | "bankAccount" | "ifsc"> {
  const { pan, email, phone, bankAccount, ifsc, ...safe } = vendor as Record<string, unknown>;
  return safe as Omit<T, "pan" | "email" | "phone" | "bankAccount" | "ifsc">;
}

/** Check if a user context has PII read access. */
function hasPiiAccess(ctx: RequestContext): boolean {
  return hasAnyRole(ctx, PII_AUTHORIZED_ROLES as unknown as string[]);
}

export async function vendorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/procurement/vendors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const result = await queries.listVendors(ctx.tenantId, q.limit, q.offset);

    if (!hasPiiAccess(ctx)) {
      return reply.code(403).send({
        code: "PII_ACCESS_DENIED",
        message: "insufficient role for PII access",
        data: result.data.map((v) => stripPii(v)),
      });
    }

    sendValidated(reply, vendorListResponseSchema, result);
  });

  app.post("/v1/procurement/vendors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createVendorBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createVendor(ctx, body));
  });

  app.patch("/v1/procurement/vendors/:id/empanel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = empanelBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.empanelVendor(ctx, id, body));
  });

  app.patch("/v1/procurement/vendors/:id/blacklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = blacklistBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.blacklistVendor(ctx, id, body));
  });

  app.get("/v1/procurement/vendors/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const vendor = await queries.getVendor(id, ctx.tenantId);
    if (!vendor) throw new HttpError(404, "NOT_FOUND", "vendor not found");

    if (!hasPiiAccess(ctx)) {
      return reply.code(403).send({
        code: "PII_ACCESS_DENIED",
        message: "insufficient role for PII access",
        data: stripPii(vendor),
      });
    }

    return reply.send({ data: vendor });
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
