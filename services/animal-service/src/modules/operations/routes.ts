import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as complaintsRepo from "../complaints/repo.js";

const ADMIN_ROLES = ["animal_admin", "super_admin"];

const recordBody = z.object({
  complaintId: z.string().uuid(),
  operationType: z.enum(["capture", "sterilize", "vaccinate", "relocate", "shelter", "carcass_removal", "treatment"]),
  performedAt: z.string().datetime(),
  animalTagId: z.string().optional(),
  location: z.object({
    lat: z.number().optional(),
    lng: z.number().optional(),
    address: z.string().optional(),
  }).optional(),
  notes: z.string().optional(),
  beforePhoto: z.string().optional(),
  afterPhoto: z.string().optional(),
  shelterRef: z.string().optional(),
});

const complaintIdParam = z.object({ complaintId: z.string().uuid() });

export async function operationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/animal/operations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = recordBody.parse(req.body);
    // Previously this accepted any UUID-shaped complaintId with no existence
    // check, letting an operation row reference a complaint that doesn't
    // exist (or belongs to a different tenant) -- an orphan row that would
    // never surface through GET /v1/animal/complaints/:complaintId/operations
    // for a real complaint, and that no FK enforces (animal_operations.
    // complaint_id has no REFERENCES constraint; see migrations/0001_initial.sql).
    const complaint = await complaintsRepo.findById(body.complaintId, ctx.tenantId);
    if (!complaint) throw new HttpError(404, "COMPLAINT_NOT_FOUND", "Complaint not found");
    return reply.code(202).send(await commands.recordOperation(ctx, body));
  });

  app.get("/v1/animal/complaints/:complaintId/operations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { complaintId } = complaintIdParam.parse(req.params);
    const rows = await repo.listByComplaint(complaintId, ctx.tenantId);
    return reply.send({ data: rows });
  });
}
