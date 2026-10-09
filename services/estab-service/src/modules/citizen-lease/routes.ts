import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { maskAndAuditRead } from "../../shared/data-governance.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN_ROLES  = ["estab_officer", "estab_admin", "super_admin"];
const READER_ROLES = [...ADMIN_ROLES, "audit_officer", "citizen", "employee"];
// Officers (incl. read-only audit_officer) see the tenant's records; citizen
// and employee callers only the ones they created. PII stays masked for
// audit_officer (see shared/data-governance.ts).
const OFFICER_ROLES = [...ADMIN_ROLES, "audit_officer"];
const ownerScope = (ctx: RequestContext): string | undefined =>
  hasAnyRole(ctx, OFFICER_ROLES) ? undefined : ctx.actorId;

// Money fields travel as decimal strings and are BigInt()-ed in the consumer,
// which swallows errors: reject anything non-numeric here so the caller sees a 400.
const minorUnits = z.string().regex(/^\d+$/).max(18);

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  status: z.string().optional(),
  limit:  z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const createPropertyBody = z.object({
  propertyCode: z.string().min(1),
  propertyType: z.enum(["shop", "stall", "plot", "kiosk", "community_space"]),
  location: z.record(z.unknown()).optional(),
  area: z.string().optional(),
  areaUnit: z.string().max(16).optional(),
  monthlyRentMinor: minorUnits,
  leaseTermMonths: z.number().int().positive().optional(),
});

const createLeaseBody = z.object({
  propertyId: z.string().uuid(),
  tenantName: z.string().min(1),
  tenantPhone: z.string().max(15).optional(),
  tenantAadhaar: z.string().length(12).optional(),
  tenantAddress: z.record(z.unknown()).optional(),
  leaseStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  leaseEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monthlyRentMinor: minorUnits,
  securityDepositMinor: minorUnits.optional(),
});

const paymentBody = z.object({
  paymentMonth: z.string().regex(/^\d{4}-\d{2}$/),
  amountMinor: minorUnits,
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentRef: z.string().optional(),
});

const leaseRequestBody = z.object({
  leaseId: z.string().uuid(),
  requestType: z.enum(["renewal", "transfer", "surrender", "no_dues"]),
  transfereeName: z.string().optional(),
  transfereePhone: z.string().max(15).optional(),
  transfereeAadhaar: z.string().length(12).optional(),
  surrenderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const reviewBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  remarks: z.string().max(2000).optional(),
});

const completeBody = z.object({
  noDuesCertificateRef: z.string().optional(),
});

export async function citizenLeaseRoutes(app: FastifyInstance): Promise<void> {
  // ── Properties ─────────────────────────────────────────────────────────
  app.get("/v1/estab/citizen-lease/properties", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuery.parse(req.query);
    return reply.send(await queries.listProperties(ctx.tenantId, { status: q.status ?? undefined }, q.limit, q.offset));
  });

  app.get("/v1/estab/citizen-lease/properties/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const prop = await queries.getProperty(ctx.tenantId, id);
    if (!prop) throw new HttpError(404, "NOT_FOUND", "property not found");
    return reply.send({ data: prop });
  });

  app.post("/v1/estab/citizen-lease/properties", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createPropertyBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createProperty(ctx, body));
  });

  // ── Leases ─────────────────────────────────────────────────────────────
  app.get("/v1/estab/citizen-lease/leases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuery.parse(req.query);
    const page = await queries.listLeases(ctx.tenantId, { status: q.status ?? undefined, ownerId: ownerScope(ctx) }, q.limit, q.offset);
    return reply.send({ ...page, data: await maskAndAuditRead(ctx, "lease", page.data as Record<string, unknown>[]) });
  });

  app.get("/v1/estab/citizen-lease/leases/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const lease = await queries.getLease(ctx.tenantId, id, ownerScope(ctx));
    if (!lease) throw new HttpError(404, "NOT_FOUND", "lease not found");
    const [masked] = await maskAndAuditRead(ctx, "lease", [lease as Record<string, unknown>]);
    return reply.send({ data: masked });
  });

  app.post("/v1/estab/citizen-lease/leases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createLeaseBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createLease(ctx, body));
  });

  // ── Payments ───────────────────────────────────────────────────────────
  app.get("/v1/estab/citizen-lease/leases/:id/payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const owner = ownerScope(ctx);
    if (owner && !(await queries.getLease(ctx.tenantId, id, owner))) throw new HttpError(404, "NOT_FOUND", "lease not found");
    return reply.send({ data: await queries.listLeasePayments(ctx.tenantId, id) });
  });

  app.post("/v1/estab/citizen-lease/leases/:id/payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = paymentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordLeasePayment(ctx, id, body));
  });

  // ── Lease Requests ─────────────────────────────────────────────────────
  app.get("/v1/estab/citizen-lease/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuery.parse(req.query);
    const page = await queries.listRequests(ctx.tenantId, { status: q.status ?? undefined, ownerId: ownerScope(ctx) }, q.limit, q.offset);
    return reply.send({ ...page, data: await maskAndAuditRead(ctx, "lease_request", page.data as Record<string, unknown>[]) });
  });

  app.get("/v1/estab/citizen-lease/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const req_ = await queries.getRequest(ctx.tenantId, id, ownerScope(ctx));
    if (!req_) throw new HttpError(404, "NOT_FOUND", "request not found");
    const [masked] = await maskAndAuditRead(ctx, "lease_request", [req_ as Record<string, unknown>]);
    return reply.send({ data: masked });
  });

  app.post("/v1/estab/citizen-lease/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const body = leaseRequestBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitLeaseRequest(ctx, body));
  });

  app.post("/v1/estab/citizen-lease/requests/:id/review", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reviewBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.reviewLeaseRequest(ctx, id, body));
  });

  app.post("/v1/estab/citizen-lease/requests/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeLeaseRequest(ctx, id, body));
  });
}
