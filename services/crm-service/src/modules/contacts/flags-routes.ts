/**
 * Gap 4: Vulnerable-Customer Priority Flags — routes to manage flags on contacts.
 * Emits crm.contact.flagged event when a flagged contact is relevant for helpdesk escalation.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const flagValues = ["vulnerable", "senior", "disabled", "minor", "vip"] as const;

const addFlagBody = z.object({
  flag: z.enum(flagValues),
  reason: z.string().max(500).optional(),
});

const idParam = z.object({ id: z.string().uuid() });
const flagParam = z.object({ id: z.string().uuid(), flag: z.enum(flagValues) });

interface PriorityFlag {
  flag: string;
  reason: string | undefined;
  flaggedBy: string;
  flaggedAt: string;
}

export async function flagRoutes(app: FastifyInstance): Promise<void> {
  // Add a flag
  app.post("/v1/crm/contacts/:id/flags", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = addFlagBody.parse(req.body);

    // Get current flags
    const current = (await scopedRead((tx) => tx.execute(sql`
      SELECT priority_flags FROM crm.contacts
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<{ priority_flags: PriorityFlag[] }>;

    if (current.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "contact not found");
    }

    const flags: PriorityFlag[] = current[0]!.priority_flags ?? [];

    // Check if flag already exists
    if (flags.some((f) => f.flag === body.flag)) {
      throw new HttpError(409, "FLAG_EXISTS", `flag '${body.flag}' already set on this contact`);
    }

    const newFlag: PriorityFlag = {
      flag: body.flag,
      reason: body.reason,
      flaggedBy: ctx.actorId,
      flaggedAt: new Date().toISOString(),
    };

    const updated = [...flags, newFlag];

    await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.contacts
      SET priority_flags = ${JSON.stringify(updated)}::jsonb,
          updated_at = now(), updated_by = ${ctx.actorId}, version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
    `));

    // Emit event for helpdesk integration (auto-escalate tickets from flagged contacts)
    await queue.publish(EVENTS.contactFlagged, {
      messageId: `flag-${id}-${body.flag}-${Date.now()}`,
      type: EVENTS.contactFlagged,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { contactId: id, flag: body.flag, action: "added" },
    });

    return reply.code(201).send({ data: newFlag });
  });

  // List flags
  app.get("/v1/crm/contacts/:id/flags", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT priority_flags FROM crm.contacts
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<{ priority_flags: PriorityFlag[] }>;

    if (rows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "contact not found");
    }

    const flags: PriorityFlag[] = rows[0]!.priority_flags ?? [];
    return reply.send({ data: flags });
  });

  // Remove a flag
  app.delete("/v1/crm/contacts/:id/flags/:flag", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id, flag } = flagParam.parse(req.params);

    const current = (await scopedRead((tx) => tx.execute(sql`
      SELECT priority_flags FROM crm.contacts
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<{ priority_flags: PriorityFlag[] }>;

    if (current.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "contact not found");
    }

    const flags: PriorityFlag[] = current[0]!.priority_flags ?? [];
    const filtered = flags.filter((f) => f.flag !== flag);

    if (filtered.length === flags.length) {
      throw new HttpError(404, "FLAG_NOT_FOUND", `flag '${flag}' not set on this contact`);
    }

    await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.contacts
      SET priority_flags = ${JSON.stringify(filtered)}::jsonb,
          updated_at = now(), updated_by = ${ctx.actorId}, version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
    `));

    // Emit removal event
    await queue.publish(EVENTS.contactFlagged, {
      messageId: `unflag-${id}-${flag}-${Date.now()}`,
      type: EVENTS.contactFlagged,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { contactId: id, flag, action: "removed" },
    });

    return reply.code(204).send();
  });
}
