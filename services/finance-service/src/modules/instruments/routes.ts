import type { FastifyInstance, FastifyReply } from "fastify";
import { resolveContext, requireRole, financeErrorHandler } from "../../shared/context.js";
import {
  issueInstrumentBody,
  bounceInstrumentBody,
  listInstrumentsQuery,
  reasonedInstrumentBody,
  staleInstrumentBody,
  revealAccountBody,
  idParam,
} from "./validators.js";
import * as commands from "./commands.js";
import type { Accepted } from "../../shared/finance-command.js";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES  = [...FINANCE_ROLES, "audit_officer"];
/** Who may reveal the drawn-on bank account number (audited, reason required). */
export const BANK_ACCOUNT_REVEAL_ROLES = ["finance_officer", "finance_admin", "accounts_officer", "super_admin"];

/** The updated instrument (200) once the consumer has applied the command, else 202 Accepted. */
function sendResult(reply: FastifyReply, result: commands.InstrumentView | Accepted) {
  if (result.status === "accepted") {
    return sendAccepted(reply, acceptedResponseSchema, result);
  }
  return reply.send(result);
}

/**
 * Cheque / DD payment instruments — issuance + tenant-scoped status lifecycle
 * (issued -> presented -> cleared | bounced | cancelled). All transitions are
 * idempotent and guarded by an atomic conditional UPDATE in the repo.
 */
export async function instrumentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/instruments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = issueInstrumentBody.parse(req.body);
    const view = await commands.issueInstrument(ctx, body);
    // Applied -> the instrument (201, as before). Queued but not yet applied -> 202 Accepted.
    if (view.status === "accepted") return sendAccepted(reply, acceptedResponseSchema, view);
    return reply.code(201).send(view);
  });

  app.get("/v1/finance/instruments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listInstrumentsQuery.parse(req.query);
    const data = await commands.listInstruments(ctx, {
      limit: q.limit,
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
    });
    return reply.send({ data, pagination: { hasMore: data.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/finance/instruments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await commands.getInstrument(ctx, id));
  });

  app.post("/v1/finance/instruments/:id/present", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    return sendResult(reply, await commands.presentInstrument(ctx, id));
  });

  app.post("/v1/finance/instruments/:id/clear", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    return sendResult(reply, await commands.clearInstrument(ctx, id));
  });

  app.post("/v1/finance/instruments/:id/bounce", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = bounceInstrumentBody.parse(req.body ?? {});
    return sendResult(reply, await commands.bounceInstrument(ctx, id, body));
  });

  app.post("/v1/finance/instruments/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reasonedInstrumentBody.parse(req.body ?? {});
    return sendResult(reply, await commands.cancelInstrument(ctx, id, body));
  });

  app.post("/v1/finance/instruments/:id/represent", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reasonedInstrumentBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.representInstrument(ctx, id, body));
  });

  app.post("/v1/finance/instruments/:id/stale", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = staleInstrumentBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.markInstrumentStale(ctx, id, body));
  });

  app.post("/v1/finance/instruments/:id/reveal-account", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BANK_ACCOUNT_REVEAL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = revealAccountBody.parse(req.body);
    reply.header("cache-control", "no-store");
    return reply.send(await commands.revealInstrumentAccount(ctx, id, body.reason));
  });

  app.setErrorHandler(financeErrorHandler);
}
