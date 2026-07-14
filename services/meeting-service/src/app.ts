import Fastify, { type FastifyInstance } from "fastify";
import { registerOpsRoutes, dbPing } from "@civitasone/observability";
import { createTenantTxHook, tenantStorage } from "@civitasone/db";
import { cache, queue } from "./shared/infra.js";
import { db, sqlClient } from "./shared/db.js";
import { registerSchemaErrorHandler } from "@civitasone/schemas/plugin";
import { HttpError } from "./shared/context.js";
import { assertPiiKeyConfigured } from "./shared/pii-crypto.js";
import cors from "@fastify/cors";
import { authPlugin } from "@civitasone/auth/plugin";
import { randomUUID } from "node:crypto";
import { meetingCoreRoutes } from "./modules/meeting-core/routes.js";
import { committeeRoutes } from "./modules/committee/routes.js";
import { agendaRoutes } from "./modules/agenda/routes.js";
import { votingRoutes } from "./modules/voting/routes.js";
import { attendanceRoutes } from "./modules/attendance/routes.js";
import { participantRoutes } from "./modules/participant/routes.js";
import { minutesRoutes } from "./modules/minutes/routes.js";
import { decisionRoutes } from "./modules/decision/routes.js";
import { actionItemRoutes } from "./modules/action-item/routes.js";
import { calendarRoutes } from "./modules/calendar/routes.js";
import { documentRoutes } from "./modules/document/routes.js";
import { aiAssistRoutes } from "./modules/ai-assist/routes.js";
import { vcRoutes } from "./modules/vc-integration/routes.js";
import { configRegistryRoutes } from "./modules/config-registry/routes.js";

/**
 * meeting-service Fastify application factory.
 *
 * Mirrors the established sibling-service shape (visitor / citizen / finance):
 *   1. fail-fast PII key assertion (never boot fail-open),
 *   2. structured Pino logger with a correlation-id request id,
 *   3. CORS + Keycloak auth plugin,
 *   4. per-request tenant transaction hook (sets the app.tenant_id GUC so
 *      PostgreSQL RLS enforces isolation even if an app-layer WHERE is missed),
 *   5. ops routes — /health (+/ready) DB+Redis+Queue readiness/liveness and
 *      /metrics (Prometheus) — provided by @civitasone/observability,
 *   6. module route registrations (added incrementally — see task 19.2),
 *   7. the standard error handler that maps HttpError → the standard envelope
 *      `{ error: { code, message, details?, correlationId } }` and collapses
 *      unhandled errors to a generic 500 (raw PG/Redis errors never leak).
 */
export async function buildApp(): Promise<FastifyInstance> {
  // Fail-fast if MEETING_PII_KEY is absent/too short so we never boot fail-open
  // (participant personal_email / personal_phone are PII-encrypted at rest).
  assertPiiKeyConfigured();

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-correlation-id"] as string) ?? randomUUID(),
  });

  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false });

  await app.register(authPlugin);

  // G2: RLS enforcement — set app.tenant_id GUC per request so RLS policies
  // enforce tenant isolation even if app-layer WHERE is accidentally omitted.
  app.addHook("onRequest", createTenantTxHook(db));

  // Source the RLS tenant from the AUTHENTICATED token (req.ctx, populated by
  // authPlugin's earlier onRequest hook), not the client-supplied x-tenant-id
  // header. createTenantTxHook only enters AsyncLocalStorage when x-tenant-id is
  // present; token-based requests omit it, so without this the app.tenant_id GUC
  // stays unset and -- under FORCE ROW LEVEL SECURITY -- the fail-closed policy
  // returns zero rows on reads. Sourcing tenantId from the verified token here
  // makes scopedRead()'s transaction set the GUC so RLS enforces isolation on
  // reads AND writes.
  app.addHook("onRequest", async (req) => {
    const tid = (req as { ctx?: { tenantId?: string } }).ctx?.tenantId;
    if (tid) tenantStorage.enterWith({ tenantId: tid });
  });

  // /health (+/ready) readiness+liveness over DB + Redis + Queue, and /metrics
  // (Prometheus: request rate, error rate, p50/p95/p99, cache/queue signals).
  registerOpsRoutes(app, { service: "meeting-service", checks: { db: { ping: () => dbPing(sqlClient) }, cache, queue } });

  // Uniform Zod + HttpError → standard-envelope handler. Installed BEFORE the module route
  // plugins so every encapsulated route context inherits it: in Fastify v4 an error handler set
  // AFTER a plugin is registered does not propagate into that already-created child context, so a
  // Zod parse error thrown inside a route would otherwise fall through to Fastify's default 500.
  registerSchemaErrorHandler(app, HttpError);

  // ─── Module route registrations ──────────────────────────────────────────
  // Added one per module as each is scaffolded, then fully wired in task 19.2
  // ("Wire app.ts with all module routes and middleware"). Keep registrations
  // in the same order as the design's module table so a missing one is obvious:
  //   meeting-core, committee, agenda, participant, attendance, minutes,
  //   decision, action-item, voting, vc-integration, calendar, document,
  //   ai-assist.
  await app.register(meetingCoreRoutes);
  await app.register(committeeRoutes);
  await app.register(agendaRoutes);
  await app.register(participantRoutes);
  await app.register(attendanceRoutes);
  await app.register(minutesRoutes);
  await app.register(decisionRoutes);
  await app.register(actionItemRoutes);
  await app.register(votingRoutes);
  await app.register(vcRoutes);
  await app.register(calendarRoutes);
  await app.register(documentRoutes);
  await app.register(aiAssistRoutes);
  await app.register(configRegistryRoutes);

  return app;
}
