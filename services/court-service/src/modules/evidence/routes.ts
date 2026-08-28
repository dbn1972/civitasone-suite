import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { caseIdParam, evidenceIdParam, submitEvidenceBody, ruleEvidenceBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

// Submitting parties: registry desk, court admin, and advocates may tender exhibits.
const EVIDENCE_WRITE_ROLES = ["registrar", "court_admin", "advocate", "super_admin"];
// Only the bench rules on admissibility.
const EVIDENCE_RULE_ROLES = ["judge", "court_admin", "super_admin"];
// Everyone who can write evidence, plus the clerk who preps the case file and the
// judge who rules on it — a role that can rule on an exhibit must be able to read it.
const EVIDENCE_READ_ROLES = ["registrar", "court_admin", "advocate", "court_clerk", "judge", "super_admin"];

export async function evidenceRoutes(app: FastifyInstance): Promise<void> {
  // Submit a piece of evidence/exhibit on a case.
  app.post("/v1/court/cases/:id/evidence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EVIDENCE_WRITE_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const body = submitEvidenceBody.parse(req.body);
    const result = await commands.submitEvidence(ctx, id, body);
    return reply.code(202).send(result);
  });

  // List a case's evidence/exhibits.
  app.get("/v1/court/cases/:id/evidence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EVIDENCE_READ_ROLES);
    const { id } = caseIdParam.parse(req.params);
    const items = await repo.listByCase(ctx.tenantId, id);
    return reply.send({ items, count: items.length, source: "db" });
  });

  // Rule on an exhibit (admit | reject | mark) — bench only.
  app.patch("/v1/court/evidence/:id/rule", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EVIDENCE_RULE_ROLES);
    const { id } = evidenceIdParam.parse(req.params);
    const body = ruleEvidenceBody.parse(req.body);
    const result = await commands.ruleOnEvidence(ctx, id, body);
    return reply.code(202).send(result);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "evidence route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
