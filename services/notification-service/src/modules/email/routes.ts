/**
 * CR-MKT-04 — email deliverability: sending domains + DKIM/SPF/DMARC health.
 *
 * POST /v1/notification/email/sending-domains                   — register (202)
 * GET  /v1/notification/email/sending-domains                   — list
 * POST /v1/notification/email/sending-domains/:id/auth-checks   — submit a check result (202)
 * GET  /v1/notification/email/sending-domains/:id/health        — current health + history
 *
 * NOTE: no route performs a DNS lookup. The auth-check endpoint records a result
 * that the scheduled checker (see ./sweeper.ts) already resolved, which keeps
 * request handling free of network I/O and the whole feature testable offline.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { DMARC_POLICIES, isSendingAllowed, type DomainHealth } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const WRITE_ROLES = ["notification_admin", "super_admin", "tenant_admin", "platform_admin"];
const READ_ROLES = [...WRITE_ROLES, "audit_officer"];

/** RFC 1035 label syntax, at least two labels. Rejects a bare hostname. */
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const registerBody = z.object({
  domain: z.string().min(4).max(253).refine((v) => DOMAIN_RE.test(v), "must be a valid DNS domain"),
  dkimSelector: z.string().min(1).max(63).regex(/^[a-z0-9._-]+$/i, "invalid DKIM selector"),
  dkimValue: z.string().min(8).max(4096),
  spfInclude: z.string().min(3).max(253),
  dmarcPolicy: z.enum(["none", "quarantine", "reject"]),
});

const txtArray = z.array(z.string().max(4096)).max(20);

const authCheckBody = z.object({
  dkimTxt: txtArray.default([]),
  spfTxt: txtArray.default([]),
  dmarcTxt: txtArray.default([]),
  source: z.enum(["scheduled", "manual"]).default("scheduled"),
  checkedAt: z.string().datetime().optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200),
  offset: z.coerce.number().int().min(0).default(0),
});

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

const idParam = z.object({ id: z.string().uuid() });

export async function emailDeliverabilityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/notification/email/sending-domains", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = registerBody.parse(req.body);
    // 422: the SPF include has to be an `include:` mechanism, not a bare host —
    // storing a bare host would make every future SPF evaluation fail silently.
    if (!/^include:/i.test(body.spfInclude)) {
      throw new HttpError(422, "INVALID_SPF_INCLUDE", "spfInclude must be an include: mechanism, e.g. include:spf.example.net");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.registerSendingDomain(ctx, body));
  });

  app.get("/v1/notification/email/sending-domains", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listDomains(ctx.tenantId, q.limit, q.offset);
    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        domain: r.domain,
        dkimSelector: r.dkimSelector,
        spfInclude: r.spfInclude,
        dmarcPolicy: r.dmarcPolicy,
        health: r.health,
        enabled: r.enabled,
        lastCheckedAt: r.lastCheckedAt ? r.lastCheckedAt.toISOString() : null,
      })),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  app.post("/v1/notification/email/sending-domains/:id/auth-checks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = authCheckBody.parse(req.body ?? {});
    const domain = await repo.findDomainById(ctx.tenantId, id);
    if (!domain) throw new HttpError(404, "NOT_FOUND", "sending domain not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordDomainAuthCheck(ctx, {
      sendingDomainId: id,
      dkimTxt: body.dkimTxt,
      spfTxt: body.spfTxt,
      dmarcTxt: body.dmarcTxt,
      source: body.source,
      ...(body.checkedAt !== undefined ? { checkedAt: body.checkedAt } : {}),
    }));
  });

  app.get("/v1/notification/email/sending-domains/:id/health", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = historyQuery.parse(req.query);
    const domain = await repo.findDomainById(ctx.tenantId, id);
    if (!domain) throw new HttpError(404, "NOT_FOUND", "sending domain not found");
    const checks = await repo.listChecks(ctx.tenantId, id, q.limit);
    return reply.send({
      data: {
        sendingDomainId: domain.id,
        domain: domain.domain,
        health: domain.health,
        sendingAllowed: isSendingAllowed(domain.health as DomainHealth),
        lastCheckedAt: domain.lastCheckedAt ? domain.lastCheckedAt.toISOString() : null,
        expected: {
          dkimSelector: domain.dkimSelector,
          spfInclude: domain.spfInclude,
          dmarcPolicy: domain.dmarcPolicy,
        },
        history: checks.map((c) => ({
          id: c.id,
          dkimStatus: c.dkimStatus,
          spfStatus: c.spfStatus,
          dmarcStatus: c.dmarcStatus,
          health: c.health,
          source: c.source,
          checkedAt: c.checkedAt.toISOString(),
        })),
      },
    });
  });

  /** Exposed so operators can see which policies the validator accepts. */
  app.get("/v1/notification/email/dmarc-policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({ data: DMARC_POLICIES });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
