/**
 * Integration module routes — external HR system sync configuration and status.
 * Provides endpoints for managing integrations with eHRMS, PFMS payroll feed,
 * DigiLocker verification, and biometric device sync.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";

const ADMIN_ROLES = ["hr_admin", "super_admin", "platform_admin"];

// SEC-010: employee.integrations / employee.integration_sync_log are now
// FORCE RLS'd. This module has no Drizzle schema for either table (they were
// always accessed via raw SQL), so these routes used sqlPool.query() — a bare
// pool-tier client with no app.tenant_id GUC (see shared/db.ts's doc comment
// on scopedRead). Under FORCE RLS that fails closed: every SELECT would
// silently return zero rows and every INSERT/UPDATE would be rejected by
// WITH CHECK. Fixed by running the same raw SQL text inside scopedRead() / a
// transaction, which sets the GUC via wrapWithTenantGuc — same remedy as
// TX-002/TX-003 ("route through tx") and 0135's audit.ts companion fix,
// applied here to raw SQL instead of the query builder because no Drizzle
// schema exists for these two tables.
//
// F3 CQRS boundary note (tests/f3-leftover-hrms-cqrs.test.ts): the two
// transaction-wrapped writes below (create, sync) are pre-existing
// synchronous writes, unchanged in kind by this migration — the original
// code awaited `sqlPool.query(INSERT/UPDATE ...)` synchronously in the same
// route handler; that scanner just never recognised sqlPool as a
// Drizzle/write call. Converting either to the async publishF3Write pattern
// is out of scope for a same-file RLS fix and would change response
// semantics: POST /integrations echoes the row's own id/status back in its
// 201 body, and the sync endpoint must answer 404/422 synchronously from the
// row's *current* state. See KNOWN_INTENTIONAL_SYNC_WRITES in that test file.
//
// tx.execute(sql`...`) on this driver resolves to the row array directly
// (not a `{ rows }` wrapper — see shared/db.ts's sqlPool comment on the
// postgres-js client shape). Normalised defensively so this keeps working
// across the pending drizzle-orm 0.30.10 -> 0.45.2 upgrade (SEC-018) even if
// that changes.
function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const withRows = result as { rows?: T[] } | undefined;
  return withRows?.rows ?? [];
}

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  // List configured integrations for a tenant
  app.get("/v1/hrms/integrations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const result = await scopedRead((tx) =>
      tx.execute(sql`
        SELECT id, name, type, status, last_sync_at, config
        FROM employee.integrations
        WHERE tenant_id = ${ctx.tenantId} ORDER BY name
      `),
    );
    return reply.send({ data: rowsOf(result) });
  });

  // Create/register a new integration
  app.post("/v1/hrms/integrations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = z.object({
      name: z.string().min(1).max(128),
      type: z.enum(["ehrms", "pfms_payroll", "digilocker", "biometric", "custom"]),
      config: z.record(z.unknown()).default({}),
    }).parse(req.body);

    const id = randomUUID();
    await db.transaction((tx) =>
      tx.execute(sql`
        INSERT INTO employee.integrations (id, tenant_id, name, type, config, status, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${body.name}, ${body.type}, ${JSON.stringify(body.config)}, 'active', ${ctx.actorId})
      `),
    );
    return reply.code(201).send({ data: { id, ...body, status: "active" } });
  });

  // Trigger a sync for a specific integration
  app.post("/v1/hrms/integrations/:id/sync", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    // Check + update in one tenant-scoped transaction (also closes a
    // pre-existing TOCTOU gap between the two previously-separate queries).
    await db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        SELECT id, type, status FROM employee.integrations WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `);
      const row = rowsOf<{ id: string; type: string; status: string }>(result)[0];
      if (!row) throw new HttpError(404, "NOT_FOUND", "Integration not found");
      if (row.status !== "active") throw new HttpError(422, "INACTIVE", "Integration is not active");

      // Record sync attempt
      await tx.execute(sql`
        UPDATE employee.integrations SET last_sync_at = NOW() WHERE id = ${id}
      `);
    });
    return reply.code(202).send({ data: { id, syncStatus: "initiated", initiatedAt: new Date().toISOString() } });
  });

  // Get sync history for an integration
  app.get("/v1/hrms/integrations/:id/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await scopedRead((tx) =>
      tx.execute(sql`
        SELECT id, status, records_synced, errors, started_at, completed_at
        FROM employee.integration_sync_log
        WHERE integration_id = ${id} AND tenant_id = ${ctx.tenantId}
        ORDER BY started_at DESC LIMIT 50
      `),
    );
    return reply.send({ data: rowsOf(result) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
