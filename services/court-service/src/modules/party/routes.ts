import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { maskEmail, maskPhone } from "../../shared/pii-crypto.js";
import { caseIdParam, partyIdParam, addPartyBody, updateAdvocateBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const PARTY_WRITE_ROLES = ["registrar", "court_admin", "super_admin"];
const PARTY_READ_ROLES  = ["registrar", "court_admin", "super_admin", "court_clerk", "judge"];

/**
 * Roles allowed to see FULL cleartext party PII (name/address/phone/email). All
 * other read roles receive masked phone/email and REDACTED name/address (null).
 * PII is decrypted only server-side and masked per role — DPDP Act 2023 data
 * minimization (Req 15.3): expose the least PII the caller's role needs.
 */
const PII_PRIVILEGED_ROLES = ["judge", "court_admin", "super_admin"];

export async function partyRoutes(app: FastifyInstance): Promise<void> {
  // Add a party / advocate to a case (§14/§15).
  app.post("/v1/court/cases/:id/parties", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PARTY_WRITE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = addPartyBody.parse(req.body);
    const result = await commands.addParty(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a case's parties — PII masked per role (DPDP Act 2023 minimization).
  app.get("/v1/court/cases/:id/parties", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PARTY_READ_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const rows = await repo.listPartiesByCase(ctx.tenantId, id);

    const privileged = hasAnyRole(ctx, PII_PRIVILEGED_ROLES);
    const items = rows.map((r) => {
      const base = {
        id:            r.id,
        caseId:        r.caseId,
        partyRole:     r.partyRole,
        advocateName:  r.advocateName,
        advocateBarId: r.advocateBarId,
        version:       r.version,
        createdAt:     r.createdAt,
        updatedAt:     r.updatedAt,
      };
      if (privileged) {
        // Full cleartext (decrypted server-side by the encryptedText columns).
        return {
          ...base,
          name:    r.nameEnc,
          address: r.addressEnc,
          phone:   r.phoneEnc,
          email:   r.emailEnc,
        };
      }
      // Ordinary read roles: name/address REDACTED, phone/email MASKED.
      return {
        ...base,
        name:    null,
        address: null,
        phone:   maskPhone(r.phoneEnc),
        email:   maskEmail(r.emailEnc),
      };
    });

    return reply.send({ items, count: items.length, source: "db", piiRevealed: privileged });
  });

  // Update an advocate's details on a party.
  app.patch("/v1/court/parties/:id/advocate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PARTY_WRITE_ROLES);
    const { id } = partyIdParam.parse(req.params);
    const body = updateAdvocateBody.parse(req.body);
    const result = await commands.updateAdvocate(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "party route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
