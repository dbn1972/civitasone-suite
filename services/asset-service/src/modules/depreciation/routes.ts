import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createDepScheduleBody, runDepBody, assetIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { z } from "zod";

const ASSET_ROLES  = ["asset_manager", "asset_admin", "super_admin", "finance_officer"];
const READER_ROLES = [...ASSET_ROLES, "audit_officer"];

export async function depRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/assets/assets/:id/depreciation/schedule", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = assetIdParam.parse(req.params);
    const body = createDepScheduleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDepSchedule(ctx, id, body));
  });

  app.post("/v1/assets/depreciation/run", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = runDepBody.parse(req.body);
    // GAP-ASSETS-DEPRECIATION-02: a period whose entries are all posted answers 409 instead of a
    // success-looking 202 (the consumer would find nothing due). Safe to re-run while any entry is pending.
    const books = await repo.summarizePeriod(ctx.tenantId, body.period, body.depBook === "all" ? undefined : body.depBook);
    if (books.length > 0 && books.every((b) => b.pendingCount === 0 && b.postedCount > 0)) {
      throw new HttpError(409, "ALREADY_POSTED", `depreciation for ${body.period} is already posted`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.runDepreciation(ctx, body));
  });

  // Preview + last-run indicator for the run page: what a run for `period` would post, what is already
  // posted, and the latest posted period. Read-only.
  app.get("/v1/assets/depreciation/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/, "period must be YYYY-MM"),
      depBook: z.enum(["company", "statutory", "all"]).default("all"),
    }).parse(req.query);
    const books = await repo.summarizePeriod(ctx.tenantId, q.period, q.depBook === "all" ? undefined : q.depBook);
    const last = await repo.findLastPostedPeriod(ctx.tenantId);
    return reply.send({
      period: q.period,
      books: books.map((b) => ({
        depBook: b.depBook, pendingCount: b.pendingCount, pendingMinor: b.pendingMinor.toString(),
        postedCount: b.postedCount, postedMinor: b.postedMinor.toString(), lastPostedAt: b.lastPostedAt?.toISOString() ?? null,
      })),
      lastPosted: last ? { period: last.period, postedAt: last.postedAt.toISOString() } : null,
    });
  });

  app.get("/v1/assets/assets/:id/depreciation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = assetIdParam.parse(req.params);
    const schedule = await queries.getDepSchedule(ctx.tenantId, id);
    const entries  = await queries.getDepEntries(ctx.tenantId, id);
    return reply.send({ schedule, entries });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
