/**
 * CR-MOB-01 — mobile app performance monitoring. HTTP routes.
 *
 * Extends the `health` module with the client-side half of the picture:
 *   POST /v1/admin/mobile-telemetry              ingest one batch from a device
 *   GET  /v1/admin/mobile-telemetry              raw events (paged)
 *   GET  /v1/admin/mobile-telemetry/aggregate    cold-start p50/p95 + crash/ANR
 *                                                rates by platform + app version
 *   GET  /v1/admin/mobile-telemetry/screens      screen render timings
 *
 * SECURITY POSTURE: the ingest body is attacker-controlled. It is validated by
 * zod with an explicit ceiling on EVERY numeric field (bounds come from
 * mobile-domain.ts BOUNDS, the same constants the DB CHECK constraints use),
 * plus semantic checks that zod cannot express (clock window, crash ≤ sessions,
 * unique screens). Out-of-range values are REJECTED — never clamped and stored.
 * The row is attributed to the authenticated tenant and actor, never to a
 * client-supplied identifier, and no PII is accepted or stored.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { listEnvelope, singleEnvelope, parseOrThrow, registerEnvelopeErrorHandler } from "../../shared/envelope.js";
import * as repo from "./mobile-repo.js";
import {
  BOUNDS,
  PLATFORMS,
  aggregateScreens,
  aggregateTelemetry,
  assertCountsConsistent,
  assertRecordedAtInWindow,
  assertScreensUnique,
} from "./mobile-domain.js";
import type { MobileTelemetryRow } from "./mobile-schema.js";

/**
 * Ingest is open to any authenticated app user (the mobile app runs as an
 * ordinary user), while the aggregate views are admin-only reporting surfaces.
 */
const INGEST_ROLES = [
  "employee", "officer", "manager", "citizen",
  "hr_officer", "hr_admin", "finance_officer", "finance_admin",
  ...TENANT_ADMIN_ROLES,
];
const READ_ROLES = [...TENANT_ADMIN_ROLES];

const limitSchema = z.coerce.number().int().min(1).max(200);
const pageSchema = z.coerce.number().int().min(1).max(10_000).default(1);

const ingestBody = z.object({
  appVersion: z.string().min(1).max(32).regex(/^[0-9A-Za-z.+_-]+$/, "invalid app version"),
  platform: z.enum(PLATFORMS),
  osVersion: z.string().max(32).default(""),
  deviceModel: z.string().max(64).default(""),
  coldStartMs: z.number().int().min(0).max(BOUNDS.coldStartMsMax),
  warmStartMs: z.number().int().min(0).max(BOUNDS.warmStartMsMax).optional(),
  crashCount: z.number().int().min(0).max(BOUNDS.crashCountMax).default(0),
  anrCount: z.number().int().min(0).max(BOUNDS.anrCountMax).default(0),
  sessionCount: z.number().int().min(BOUNDS.sessionCountMin).max(BOUNDS.sessionCountMax).default(1),
  /**
   * `offset: true` is required, not cosmetic. zod's bare `.datetime()` accepts
   * ONLY a `Z` suffix, so a device that reports `2026-06-30T17:30:00+05:30` —
   * an unambiguous instant, and what a client that formats in local time
   * produces — was rejected with a 400 it can do nothing about. The column is
   * `timestamptz` and assertRecordedAtInWindow parses via `new Date`, both of
   * which handle an offset correctly, so accepting one loses no precision and
   * still stores the same instant. `Z` remains valid.
   */
  recordedAt: z.string().datetime({ offset: true }),
  screens: z.array(z.object({
    screen: z.string().min(1).max(64).regex(/^[A-Za-z0-9 ._/-]+$/, "invalid screen name"),
    renderMs: z.number().int().min(0).max(BOUNDS.renderMsMax),
    sampleCount: z.number().int().min(1).max(BOUNDS.sessionCountMax).default(1),
  })).max(BOUNDS.screensPerBatchMax).default([]),
});

const filterQuery = z.object({
  limit: limitSchema,
  page: pageSchema,
  platform: z.enum(PLATFORMS).optional(),
  appVersion: z.string().min(1).max(32).optional(),
  // Same reasoning as `recordedAt` above: an offset-bearing instant is valid.
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const screenQuery = filterQuery.extend({
  screen: z.string().min(1).max(64).optional(),
});

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function serializeEvent(row: MobileTelemetryRow): Record<string, unknown> {
  return {
    id: row.id,
    appVersion: row.appVersion,
    platform: row.platform,
    osVersion: row.osVersion,
    deviceModel: row.deviceModel,
    coldStartMs: row.coldStartMs,
    warmStartMs: row.warmStartMs,
    crashCount: row.crashCount,
    anrCount: row.anrCount,
    sessionCount: row.sessionCount,
    recordedAt: iso(row.recordedAt),
    createdAt: iso(row.createdAt),
  };
}

function toFilter(q: z.infer<typeof filterQuery>): repo.TelemetryFilter {
  return {
    platform: q.platform,
    appVersion: q.appVersion,
    from: q.from !== undefined ? new Date(q.from) : undefined,
    to: q.to !== undefined ? new Date(q.to) : undefined,
  };
}

export async function mobileTelemetryRoutes(app: FastifyInstance): Promise<void> {
  // ── ingest ────────────────────────────────────────────────────────────────
  app.post("/v1/admin/mobile-telemetry", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INGEST_ROLES);
    const body = parseOrThrow(ingestBody, req.body);
    // Semantic bounds zod cannot express. Each throws 422 with a distinct code.
    const recordedAt = assertRecordedAtInWindow(body.recordedAt);
    assertCountsConsistent(body.crashCount, body.anrCount, body.sessionCount);
    assertScreensUnique(body.screens);

    const created = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const event = await repo.insertTelemetry(w, {
        tenantId: ctx.tenantId,
        appVersion: body.appVersion,
        platform: body.platform,
        osVersion: body.osVersion,
        deviceModel: body.deviceModel,
        coldStartMs: body.coldStartMs,
        warmStartMs: body.warmStartMs ?? null,
        crashCount: body.crashCount,
        anrCount: body.anrCount,
        sessionCount: body.sessionCount,
        recordedAt,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      await repo.insertScreenRenders(w, body.screens.map((s) => ({
        tenantId: ctx.tenantId,
        eventId: event.id,
        platform: body.platform,
        appVersion: body.appVersion,
        screen: s.screen,
        renderMs: s.renderMs,
        sampleCount: s.sampleCount,
        recordedAt,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      })));
      return event;
    });
    // No audit event: telemetry is non-authoritative observability data with no
    // PII, arriving once per app session per device. Emitting an audit record
    // per ping would multiply audit volume by app traffic without adding any
    // reviewable fact — the events themselves ARE the record. Every other
    // mutation in this service does emit one.
    return reply.code(201).send(singleEnvelope({ id: created.id, recordedAt: iso(created.recordedAt) }));
  });

  // ── raw events ────────────────────────────────────────────────────────────
  app.get("/v1/admin/mobile-telemetry", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = parseOrThrow(filterQuery, req.query);
    const { rows, total } = await repo.listTelemetry(ctx.tenantId, toFilter(q), q.limit, (q.page - 1) * q.limit);
    return reply.send(listEnvelope(rows.map(serializeEvent), { page: q.page, pageSize: q.limit, total }));
  });

  // ── aggregate by platform + app version ───────────────────────────────────
  app.get("/v1/admin/mobile-telemetry/aggregate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = parseOrThrow(filterQuery, req.query);
    if (q.from !== undefined && q.to !== undefined && new Date(q.from) > new Date(q.to)) {
      throw new HttpError(422, "INVALID_RANGE", "`from` must not be after `to`");
    }
    // `limit` bounds the sample pulled into the aggregate — never an unbounded scan.
    const samples = await repo.aggregateSamples(ctx.tenantId, toFilter(q), q.limit);
    const buckets = aggregateTelemetry(samples);
    return reply.send(listEnvelope(buckets, { page: 1, pageSize: q.limit, total: buckets.length }));
  });

  // ── aggregate screen render timings ───────────────────────────────────────
  app.get("/v1/admin/mobile-telemetry/screens", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = parseOrThrow(screenQuery, req.query);
    const samples = await repo.screenSamples(ctx.tenantId, { ...toFilter(q), screen: q.screen }, q.limit);
    const buckets = aggregateScreens(samples);
    return reply.send(listEnvelope(buckets, { page: 1, pageSize: q.limit, total: buckets.length }));
  });

  registerEnvelopeErrorHandler(app);
}
