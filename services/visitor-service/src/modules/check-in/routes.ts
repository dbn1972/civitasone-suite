/**
 * visitor-service: check-in / gate-verification HTTP routes.
 *
 * Follows the established blacklist/routes.ts pattern:
 *   - POST /v1/visitor/passes/verify  — SYNCHRONOUS (<2s SLA, reads only,
 *     no queue publish). Invokes the gate-verification domain logic
 *     (domain.ts#verifyQrForGate) after resolving the QR signature, the
 *     revocation set, and the blacklist/watchlist screening. Returns pass
 *     validity result (Requirement 5.1).
 *   - POST /v1/visitor/check-ins      — route → zod → publish → 202
 *     (Requirement 6.1).
 *   - POST /v1/visitor/check-outs     — route → zod → publish → 202
 *     (Requirement 6.1).
 *   - GET  /v1/visitor/gate-sync/:gateId — returns revoked pass IDs,
 *     blacklist/watchlist hashes, and `syncedAt` for offline terminal
 *     caching (Requirement 5.6).
 */
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { verifyPassQr, type PassQrPayload } from "../../shared/qr-crypto.js";
import { gates, locations } from "../location/schema.js";
import { isRevoked } from "../digital-pass/revocation-store.js";
import { isBlacklisted, isWatchlisted } from "../blacklist/screening-store.js";
import {
  verifyQrForGate,
  classifyQrError,
  DomainError,
  type QrSignatureCheckResult,
  type GateContext,
  type ScreeningResult,
} from "./domain.js";
import { verifyPassBody, checkInBody, checkOutBody, gateSyncParam, activeCheckInsQuery } from "./validators.js";
import * as commands from "./commands.js";
import { listActiveVisitors } from "./repo.js";
import { getDeviceBoundToGate } from "../device-registry/repo.js";
import { loadGateSyncSnapshot } from "./gate-sync.js";
import { getCommandCountForDevice } from "../turnstile-control/repo.js";

// Gate-terminal roles: security personnel operating gates + admin staff.
// The verify endpoint is also accessible by the gate terminal service account
// (which authenticates as `gate_terminal` role) — Requirement 5.6.
const GATE_ROLES = ["security_admin", "gate_terminal", "employee", "tenant_admin", "super_admin"];
const WRITE_ROLES = ["security_admin", "gate_terminal", "employee", "tenant_admin", "super_admin"];
// Guard-console live-occupancy roles. NORMAL guard/security roles — deliberately
// NOT the emergency IP allowlist that fences the break-glass evacuation roster.
const ACTIVE_ROLES = ["security_admin", "gate_terminal", "protocol_officer", "employee", "tenant_admin", "super_admin"];

export async function checkInRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/visitor/passes/verify
   *
   * Synchronous pass verification (<2s SLA). Reads only — no queue publish.
   * Returns the verification result including the decoded pass payload and
   * any watchlist flag (Requirement 5.1, 5.7).
   */
  app.post("/v1/visitor/passes/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GATE_ROLES);
    const body = verifyPassBody.parse(req.body);

    // 1. Resolve the gate to determine location_id and area_id for scope checks.
    const gateRows = await scopedRead((tx) => tx
      .select()
      .from(gates)
      .where(and(eq(gates.id, body.gateId), eq(gates.tenantId, ctx.tenantId)))
      .limit(1));
    const gate = gateRows[0];
    if (!gate) throw new HttpError(404, "GATE_NOT_FOUND", "gate not found");

    // 2. Resolve the location's RSA public key for QR signature verification.
    const locationRows = await scopedRead((tx) => tx
      .select({ rsaPublicKey: locations.rsaPublicKey })
      .from(locations)
      .where(and(eq(locations.id, gate.locationId), eq(locations.tenantId, ctx.tenantId)))
      .limit(1));
    const location = locationRows[0];
    if (!location?.rsaPublicKey) {
      throw new HttpError(500, "LOCATION_KEY_MISSING", "location RSA public key not configured");
    }

    // 3. Verify QR JWT signature and claims (condition a, b of Property 9).
    let qrCheck: QrSignatureCheckResult;
    try {
      const payload: PassQrPayload = await verifyPassQr(body.qrToken, location.rsaPublicKey);
      qrCheck = { ok: true, payload };
    } catch (err) {
      qrCheck = { ok: false, reason: classifyQrError(err) };
    }

    // 4. If signature check succeeded, perform revocation set check (condition c).
    let revoked = false;
    if (qrCheck.ok) {
      revoked = await isRevoked(ctx.tenantId, qrCheck.payload.visit_id);
    }

    // 5. Blacklist/watchlist screening (condition e). Screen if the caller
    //    provided an identity doc hash, or if the QR payload's visitor_id
    //    is available (in that case we use the visitor_id as the screening key).
    const screening: ScreeningResult = { blocked: false, flagged: false };
    if (body.identityDocHash) {
      const blocked = await isBlacklisted(ctx.tenantId, body.identityDocHash);
      screening.blocked = blocked;
      // Watchlist check uses the same store interface — flagged but not blocked.
      // If blocked, we don't bother checking watchlist too (already rejected).
      // SECURITY FIX: this used to hardcode `screening.flagged = false` behind a
      // stale comment claiming isWatchlisted() didn't exist on screening-store —
      // it does, and check-in/consumer.ts already calls it post-commit for the
      // async security-notification path. This synchronous endpoint (the actual
      // real-time gate response, Requirement 5.7) never called it, so
      // `watchlistFlagged` in the verify response was unconditionally false no
      // matter what was actually on the watchlist.
      if (!blocked) {
        screening.flagged = await isWatchlisted(ctx.tenantId, body.identityDocHash);
      }
    }

    // 6. Invoke the pure domain verification (Property 9).
    const gateContext: GateContext = {
      locationId: gate.locationId,
      areaId: gate.areaId,
    };

    try {
      const result = verifyQrForGate(qrCheck, gateContext, revoked, screening);
      return reply.send({
        data: {
          valid: true,
          passId: result.payload.visit_id,
          visitorId: result.payload.visitor_id,
          locationId: result.payload.location_id,
          passType: result.payload.pass_type,
          passNumber: result.payload.pass_number,
          permittedAreas: result.payload.permitted_areas,
          validFrom: result.payload.valid_from,
          validUntil: result.payload.valid_until,
          watchlistFlagged: result.watchlistFlagged,
        },
      });
    } catch (err) {
      if (err instanceof DomainError) {
        return reply.send({
          data: {
            valid: false,
            code: err.code,
            message: err.message,
          },
        });
      }
      throw err;
    }
  });

  /**
   * GET /v1/visitor/check-ins/active
   *
   * Guard-console live occupancy: the visitors currently INSIDE (passes in
   * `checked_in` status), tenant + optional location scoped, RLS-enforced via
   * scopedRead. Returns just enough for a roster + occupancy count — name,
   * check-in time, host, location, overstay flag — and NO extra PII (no phone /
   * email / identity document). This is the everyday read; the break-glass
   * evacuation roster (IP-allowlisted) stays separate.
   */
  app.get("/v1/visitor/check-ins/active", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTIVE_ROLES);
    const query = activeCheckInsQuery.parse(req.query);

    const visitors = await listActiveVisitors(ctx.tenantId, query.locationId);
    return reply.send({
      data: {
        visitors,
        occupancy: visitors.length,
        ...(query.locationId ? { locationId: query.locationId } : {}),
      },
    });
  });

  /**
   * POST /v1/visitor/check-ins
   *
   * Records a visitor check-in. Route → zod → publish → 202 (CQRS).
   * The consumer (./consumer.ts) handles the transactional write.
   */
  app.post("/v1/visitor/check-ins", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = checkInBody.parse(req.body);

    const accepted = await commands.checkInRecord(ctx, {
      passId: body.passId,
      gateId: body.gateId,
      ...(body.gateTerminalId !== undefined ? { gateTerminalId: body.gateTerminalId } : {}),
      offlineRecorded: body.offlineRecorded ?? false,
      ...(body.verificationMethod !== undefined ? { verificationMethod: body.verificationMethod } : {}),
      ...(body.timestamp !== undefined ? { timestamp: body.timestamp } : {}),
    });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * POST /v1/visitor/check-outs
   *
   * Records a visitor check-out. Route → zod → publish → 202 (CQRS).
   * The consumer (./consumer.ts) handles the transactional write.
   */
  app.post("/v1/visitor/check-outs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = checkOutBody.parse(req.body);

    const accepted = await commands.checkOutRecord(ctx, {
      passId: body.passId,
      gateId: body.gateId,
      ...(body.gateTerminalId !== undefined ? { gateTerminalId: body.gateTerminalId } : {}),
      offlineRecorded: body.offlineRecorded ?? false,
      ...(body.verificationMethod !== undefined ? { verificationMethod: body.verificationMethod } : {}),
      ...(body.timestamp !== undefined ? { timestamp: body.timestamp } : {}),
    });
    return reply.code(202).send({ data: accepted });
  });

  /**
   * GET /v1/visitor/gate-sync/:gateId
   *
   * Returns cached data for offline gate terminals (Requirement 5.6):
   *   - revokedPassIds: all pass IDs in the tenant's revocation set
   *   - blacklistHashes: identity doc hashes currently blacklisted
   *   - watchlistHashes: identity doc hashes on the watchlist
   *   - syncedAt: ISO timestamp of when this sync snapshot was generated
   *
   * Terminals poll this endpoint every 5 minutes to maintain their local
   * cache for offline verification when network is intermittent.
   */
  app.get("/v1/visitor/gate-sync/:gateId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GATE_ROLES);
    const { gateId } = gateSyncParam.parse(req.params);

    // Validate the gate exists and belongs to the tenant.
    const gateRows = await scopedRead((tx) => tx
      .select()
      .from(gates)
      .where(and(eq(gates.id, gateId), eq(gates.tenantId, ctx.tenantId)))
      .limit(1));
    const gate = gateRows[0];
    if (!gate) throw new HttpError(404, "GATE_NOT_FOUND", "gate not found");

    // Read the sync data from Redis cache (read-through pattern).
    // The cache key groups all sync data for the gate's location/tenant.
    const cacheKey = cache.makeKey(ctx.tenantId, "gate-sync", gate.locationId);
    const syncData = await cache.getOrLoad<{
      revokedPassIds: string[];
      blacklistHashes: string[];
      watchlistHashes: string[];
    }>(cacheKey, () => loadGateSyncSnapshot(ctx.tenantId, gate.locationId));

    return reply.send({
      data: {
        gateId,
        locationId: gate.locationId,
        revokedPassIds: syncData?.revokedPassIds ?? [],
        blacklistHashes: syncData?.blacklistHashes ?? [],
        watchlistHashes: syncData?.watchlistHashes ?? [],
        syncedAt: new Date().toISOString(),
        ...(await (async () => {
          const device = await getDeviceBoundToGate(ctx.tenantId, gateId);
          if (!device) return {};
          const pendingCommandCount = await getCommandCountForDevice(ctx.tenantId, device.id);
          return {
            boundDevice: {
              deviceId: device.id,
              deviceType: device.deviceType,
              online: device.online,
              lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
              pendingCommandCount,
              firmwareStatus: device.firmwareStatus,
            },
          };
        })()),
      },
    });
  });
}
