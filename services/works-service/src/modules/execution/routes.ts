import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as v from "./validators.js";
import { listScopes, listIssues } from "./repo.js";
import { getAward } from "../tender/repo.js";
import { canRecordPhysicalCompletion } from "./domain.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do", "sdo", "section_officer"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function executionRoutes(app: FastifyInstance): Promise<void> {
  // List scopes
  app.get("/v1/works/execution/:workId/scopes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = req.params as { workId: string };
    const data = await listScopes(ctx.tenantId, workId);
    return reply.send({ data });
  });

  // List issues
  app.get("/v1/works/execution/:workId/issues", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = req.params as { workId: string };
    const data = await listIssues(ctx.tenantId, workId);
    return reply.send({ data });
  });

  // Add scope
  app.post("/v1/works/execution/scopes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.addScopeSchema.parse(req.body);
    const id = randomUUID();

    await queue.publish(COMMANDS.scopeAdd, {
      messageId: randomUUID(),
      type: COMMANDS.scopeAdd,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, ...body },
    });
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Record progress
  app.post("/v1/works/execution/progress", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.recordProgressSchema.parse(req.body);
    const id = randomUUID();

    await queue.publish(COMMANDS.progressRecord, {
      messageId: randomUUID(),
      type: COMMANDS.progressRecord,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, ...body },
    });
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Upload photo
  app.post("/v1/works/execution/photos", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.uploadPhotoSchema.parse(req.body);
    const id = randomUUID();

    await queue.publish(COMMANDS.photoUpload, {
      messageId: randomUUID(),
      type: COMMANDS.photoUpload,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, ...body },
    });
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Create issue
  app.post("/v1/works/execution/issues", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createIssueSchema.parse(req.body);
    const id = randomUUID();

    await queue.publish(COMMANDS.issueCreate, {
      messageId: randomUUID(),
      type: COMMANDS.issueCreate,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, ...body },
    });
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Close work
  app.post("/v1/works/execution/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["dao", "do", "works_admin", "super_admin"]);
    const body = v.closeWorkSchema.parse(req.body);
    const id = randomUUID();

    await queue.publish(COMMANDS.workClose, {
      messageId: randomUUID(),
      type: COMMANDS.workClose,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, ...body },
    });
    return reply.status(202).send({ id, status: "accepted" });
  });

  // Record physical completion certificate (SVC-070).
  // Precondition (BR-035): a finalized agreement (award) must exist.
  app.post("/v1/works/execution/physical-complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["dao", "do", "sdo", "works_admin", "super_admin"]);
    const body = v.physicalCompleteSchema.parse(req.body);
    const award = await getAward(ctx.tenantId, body.workId);
    const hasAgreement = !!award && (award.status === "dao_finalized" || award.status === "do_finalized");
    if (!canRecordPhysicalCompletion(hasAgreement)) {
      throw new HttpError(422, "NO_AGREEMENT", "Cannot record physical completion without a finalized agreement");
    }
    const id = randomUUID();

    await queue.publish(COMMANDS.physicalComplete, {
      messageId: randomUUID(),
      type: COMMANDS.physicalComplete,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, ...body },
    });
    return reply.status(202).send({ id, status: "accepted" });
  });
}
