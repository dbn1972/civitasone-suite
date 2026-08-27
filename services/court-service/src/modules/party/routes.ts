import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { caseIdParam, partyIdParam, addPartyBody, updateAdvocateBody } from "./validators.js";
import { presentParty, PII_PRIVILEGED_ROLES } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const PARTY_WRITE_ROLES = ["registrar", "court_admin", "super_admin"];
const PARTY_READ_ROLES  = ["registrar", "court_admin", "super_admin", "court_clerk", "judge"];

// PII_PRIVILEGED_ROLES now lives in ./domain.js — case-registry/routes.ts (which
// embeds a case's parties in GET /cases/:id) shares the SAME constant and the
// SAME presentParty() masking so the two endpoints can never disagree on what
// PII a role may see.

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
    const items = rows.map((r) => presentParty(r, privileged));

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
