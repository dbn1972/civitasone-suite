import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole } from "../../shared/context.js";
import { setSignConfigBody, signBody, subjectParams } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ADMIN_ROLES = ["estab_admin", "super_admin"];
const SIGN_ROLES  = ["estab_officer", "estab_admin", "estab_deputy_secretary", "super_admin"];
const READER_ROLES = [...SIGN_ROLES, "audit_officer"];

export async function esignRoutes(app: FastifyInstance): Promise<void> {
  // Per-tenant signing policy (disabled | optional | mandatory + allowed methods).
  app.put("/v1/estab/esign/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = setSignConfigBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.setSignConfig(ctx, body));
  });

  app.get("/v1/estab/esign/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return reply.send(await repo.getSignConfig(ctx.tenantId));
  });

  // Sign a noting or DFA. Aadhaar eSign = server gateway call (web/mobile);
  // DSC = client posts the desktop-signer CMS in `pkcs7` and the server verifies.
  app.post("/v1/estab/esign/sign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SIGN_ROLES);
    const body = signBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.sign(ctx, body));
  });

  app.get("/v1/estab/esign/:subjectType/:subjectId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { subjectType, subjectId } = subjectParams.parse(req.params);
    const sigs = await repo.listSignatures(ctx.tenantId, subjectType, subjectId);
    return reply.send({
      data: sigs.map((s) => ({
        id: s.id, method: s.method, provider: s.provider,
        certSubject: s.certSubject, certIssuer: s.certIssuer, certSerial: s.certSerial,
        signerId: s.signerId, signedAt: s.signedAt, valid: s.valid, txnRef: s.txnRef,
      })),
    });
  });
}
