import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN_ROLES  = ["estab_officer", "estab_admin", "super_admin"];
const READER_ROLES = [...ADMIN_ROLES, "audit_officer", "citizen", "employee"];

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
  monthlyRentMinor: z.string().min(1),
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
  monthlyRentMinor: z.string().min(1),
  securityDepositMinor: z.string().optional(),
});

const paymentBody = z.object({
  paymentMonth: z.string().regex(/^\d{4}-\d{2}$/),
  amountMinor: z.string().min(1),
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
    return reply.send({ data: await queries.listProperties(ctx.tenantId, { status: q.status ?? undefined }) });
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
    return reply.send({ data: await queries.listLeases(ctx.tenantId, { status: q.status ?? undefined }) });
  });

  app.get("/v1/estab/citizen-lease/leases/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const lease = await queries.getLease(ctx.tenantId, id);
    if (!lease) throw new HttpError(404, "NOT_FOUND", "lease not found");
    return reply.send({ data: lease });
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
    return reply.send({ data: await queries.listLeasePayments(ctx.tenantId, id) });
  });

  app.post("/v1/estab/citizen-lease/leases/:id/payments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = paymentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordLeasePayment(ctx, id, body));
  });

  // ── Lease Requests ─────────────────────────────────────────────────────
  app.get("/v1/estab/citizen-lease/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuery.parse(req.query);
    return reply.send({ data: await queries.listRequests(ctx.tenantId, { status: q.status ?? undefined }) });
  });

  app.get("/v1/estab/citizen-lease/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const req_ = await queries.getRequest(ctx.tenantId, id);
    if (!req_) throw new HttpError(404, "NOT_FOUND", "request not found");
    return reply.send({ data: req_ });
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
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeLeaseRequest(ctx, id));
  });
}
