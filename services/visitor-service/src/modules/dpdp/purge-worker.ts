/**
 * Scheduled worker task: DPDP data-retention + right-to-erasure PII purge.
 *
 * Runs once daily (configurable) and purges PII fields from visit_requests in
 * two cases:
 *
 * 1. Retention expiry (Requirement 18.3): last activity (latest check-out, else
 *    created_at) is older than the retention period (default 365 days).
 * 2. Right to erasure (Requirement 18.4): the row carries an `erasure_requested_at`
 *    timestamp older than the erasure SLA (default 72h). dpdp/routes.ts sets
 *    erasure_requested_at when a data-subject requests erasure and PROMISES purge
 *    within 72h — before this worker it was a no-op because the retention pass
 *    only looked at the 365-day cutoff and never read erasure_requested_at.
 *
 * CROSS-TENANT under RLS: the eligibility scan spans ALL tenants, so it reads
 * through the BYPASSRLS `scannerDb` pool (shared/scanner-db.ts). Every WRITE runs
 * on the primary `db` inside `runWithTenant(tenantId, ...)` so the purge UPDATE is
 * RLS-checked and tenant-scoped. Under the least-privilege visitor_svc role the
 * old single-pool `db.select()` scan returned ZERO rows, so the purge silently did
 * nothing in production.
 *
 * Purged PII columns: visitorName, visitorPhone, visitorEmail, identityDocRef,
 * photoRef. The anonymized visit_requests row is retained for statistical
 * reporting.
 *
 * CASCADE (Requirement 18.4 full erasure, not just visit_requests): a single
 * visitor's PII is independently copied into several other tables reachable
 * from the same visit_request via the pass/group/scan graph, and none of them
 * were ever touched by this worker before:
 *   - visitor.group_members.memberName / identityDocRef   (group-visit, via
 *     group_visits.visitRequestId)
 *   - visitor.vehicle_passes.driverName                   (vehicle-pass, via
 *     digital_passes.visitRequestId)
 *   - visitor.print_jobs.renderedPayload                  (badge-print, via
 *     digital_passes.visitRequestId) — stored PLAINTEXT, not even encrypted
 *   - visitor.ocr_results (fullName/dateOfBirth/idDocumentNumber/address)
 *     (document-scan) — scan_sessions/ocr_results carry NO FK back to
 *     visit_requests at all (confirmed against migrations/0008 and
 *     modules/document-scan/schema.ts), so these rows cannot be targeted by
 *     visitRequestId. They are instead matched by identityDocHash() — the
 *     same doc-type-folded blind index used for blacklist/watchlist
 *     screening (modules/blacklist/blind-index.ts) — computed from the
 *     purged visit's own (decrypted) identityDocRef/identityDocType and
 *     compared against every tenant ocr_results row's own hash. This is a
 *     real limitation of the current schema (no indexed lookup — every
 *     tenant ocr_results row is decrypted and hashed once per cycle) but is
 *     the only correlation available without a schema change; visits with
 *     no identityDocRef cannot be matched to an ocr_results row at all.
 *   - visitor.digital_passes — not a PII copy, but a directly related
 *     consequence: an erased visitor's pass was left fully active/
 *     scannable. Any non-revoked pass for a purged visit_request is now
 *     revoked post-commit via digital-pass/commands.ts's own passRevoke()
 *     command publisher (NOT a hand-written UPDATE), so revocation stays
 *     consistent with however digital-pass's own consumer tracks it
 *     elsewhere (Redis revocation set, outboxed passRevoked event, etc).
 *   - The photo blob referenced by visit_requests.photoRef is deleted from
 *     S3/MinIO (not just the DB pointer nulled) by reusing
 *     document-scan/image-cleanup.ts's deleteFromStorage() — the same
 *     client/approach already used for expiring scan images.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import type { RequestContext } from "@civitasone/types";
import { visitRequests } from "../visit-request/schema.js";
import { digitalPasses } from "../digital-pass/schema.js";
import { passRevoke } from "../digital-pass/commands.js";
import { groupVisits, groupMembers } from "../group-visit/schema.js";
import { vehiclePasses } from "../vehicle-pass/schema.js";
import { printJobs } from "../badge-print/schema.js";
import { ocrResults } from "../document-scan/schema.js";
import { deleteFromStorage } from "../document-scan/image-cleanup.js";
import { identityDocHash } from "../blacklist/blind-index.js";
import type { Db } from "../../shared/db.js";
import { loadNamespaceOverrides } from "../config-registry/repo.js";
import { POLICY_NS, toNumber, MS_PER_DAY, MS_PER_HOUR } from "../config-registry/policy.js";

/** Sentinel value written to PII columns to indicate purged state. */
export const PURGED_SENTINEL = "[PURGED]";

/** System actor UUID used for the purge UPDATE audit columns. */
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

export interface PurgeWorkerOptions {
  /** Interval between purge runs in milliseconds. Default: 24 hours. */
  intervalMs?: number;
  /** Retention period in milliseconds. Default: 365 days. */
  retentionPeriodMs?: number;
  /** Right-to-erasure SLA in milliseconds. Default: 72 hours. */
  erasureSlaMs?: number;
  /** Maximum number of records to purge per cycle (batch size). Default: 500. */
  batchSize?: number;
  /** Pino-compatible logger. */
  logger?: { info: (...args: any[]) => void; warn: (...args: any[]) => void };
}

/**
 * Start the periodic data-retention + erasure PII purge worker.
 *
 * @param db        primary (visitor_svc) pool — writes run here inside runWithTenant.
 * @param scannerDb BYPASSRLS pool — cross-tenant eligibility scan only.
 */
export function startDataRetentionPurge(
  db: Db,
  scannerDb: Db,
  opts: PurgeWorkerOptions = {},
): NodeJS.Timeout {
  const { intervalMs = 24 * 60 * 60_000, logger } = opts;

  const timer = setInterval(() => {
    void (async () => {
      try {
        await processPurgeCycle(db, scannerDb, opts);
      } catch (err) {
        logger?.warn(
          { err, event: "dpdp_purge_cycle_failed" },
          "DPDP data-retention/erasure purge cycle failed",
        );
      }
    })();
  }, intervalMs);
  timer.unref();
  return timer;
}

/**
 * Core logic for a single purge cycle. Exported for testing.
 *
 * A row is eligible when its PII has not already been purged AND either:
 *   - COALESCE(latest check-out, created_at) < retention cutoff, OR
 *   - erasure_requested_at IS NOT NULL AND erasure_requested_at < erasure cutoff.
 *
 * The scan (scannerDb) is cross-tenant; writes are grouped per tenant and applied
 * inside runWithTenant(tenantId, ...) on the primary db so RLS scopes each UPDATE.
 */
export async function processPurgeCycle(
  db: Db,
  scannerDb: Db,
  opts: PurgeWorkerOptions = {},
): Promise<{ purgedCount: number; purgedByTenant: Record<string, number> }> {
  const {
    retentionPeriodMs = 365 * 24 * 60 * 60_000,
    erasureSlaMs = 72 * 60 * 60_000,
    batchSize = 500,
    logger,
  } = opts;

  const now = Date.now();

  // Per-tenant policy: retention window + erasure SLA are config-driven
  // (visitor_policy keys retention.pii_days / retention.erasure_sla_hours). A
  // tenant's config override WINS over the opts fallback (which itself defaults
  // to 365d / 72h), so two offices can enforce different retention with no code
  // change; a tenant that configured nothing behaves exactly as before. Loaded
  // once per cycle cross-tenant via the BYPASSRLS scanner pool (no cache — the
  // worker must see the freshest value the admin API just wrote).
  const overrides = await loadNamespaceOverrides(scannerDb, POLICY_NS);

  // Every tenant that still has un-purged visitor PII must be considered — not
  // only those with a config override — so the scan enumerates distinct tenants.
  const tenantRows = await scannerDb
    .selectDistinct({ tenantId: visitRequests.tenantId })
    .from(visitRequests)
    .where(sql`${visitRequests.visitorName} != ${PURGED_SENTINEL}`);

  const purgedByTenant: Record<string, number> = {};
  let purgedCount = 0;

  for (const { tenantId } of tenantRows) {
    // Resolve this tenant's cutoffs (config override → opts fallback → default).
    const retDays = toNumber(overrides.get(tenantId)?.get("retention.pii_days"));
    const retentionMs = retDays !== undefined ? retDays * MS_PER_DAY : retentionPeriodMs;
    const erHours = toNumber(overrides.get(tenantId)?.get("retention.erasure_sla_hours"));
    const erasureMs = erHours !== undefined ? erHours * MS_PER_HOUR : erasureSlaMs;

    const retentionCutoff = new Date(now - retentionMs).toISOString();
    const erasureCutoff = new Date(now - erasureMs).toISOString();

    // Per-tenant eligibility scan via the BYPASSRLS scanner pool. Pulls the
    // decrypted identityDocRef/identityDocType/photoRef too (not just id) —
    // the cascade below needs them BEFORE the UPDATE nulls them out.
    const eligible = await scannerDb
      .select({
        id: visitRequests.id,
        identityDocRef: visitRequests.identityDocRef,
        identityDocType: visitRequests.identityDocType,
        photoRef: visitRequests.photoRef,
      })
      .from(visitRequests)
      .where(
        and(
          eq(visitRequests.tenantId, tenantId),
          sql`${visitRequests.visitorName} != ${PURGED_SENTINEL}`,
          sql`(
            COALESCE(
              (
                SELECT MAX(ci."timestamp")
                FROM visitor.check_ins ci
                INNER JOIN visitor.digital_passes dp ON dp.id = ci.pass_id
                WHERE dp.visit_request_id = ${visitRequests.id}
                  AND ci.direction = 'out'
              ),
              ${visitRequests.createdAt}
            ) < ${retentionCutoff}
            OR (
              ${visitRequests.erasureRequestedAt} IS NOT NULL
              AND ${visitRequests.erasureRequestedAt} < ${erasureCutoff}
            )
          )`,
        ),
      )
      .limit(batchSize);

    if (eligible.length === 0) continue;
    const ids = eligible.map((r) => r.id);

    try {
      // Returned out of the transaction so post-commit best-effort side
      // effects (S3 blob deletion, pass revocation) run only after the PII
      // cascade has actually been committed durably to Postgres.
      const { photoRefsToDelete, passIdsToRevoke } = await runWithTenant(tenantId, () =>
        db.transaction(async (tx) => {
          await tx
            .update(visitRequests)
            .set({
              visitorName: PURGED_SENTINEL,
              visitorPhone: PURGED_SENTINEL,
              visitorEmail: null,
              identityDocRef: null,
              photoRef: null,
              updatedAt: new Date(),
              updatedBy: SYSTEM_ACTOR,
            })
            .where(
              and(
                sql`${visitRequests.tenantId} = ${tenantId}`,
                sql`${visitRequests.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`,
              ),
            );

          // ── group_members (via group_visits.visitRequestId) ──────────
          const groupVisitRows = await tx
            .select({ id: groupVisits.id })
            .from(groupVisits)
            .where(and(eq(groupVisits.tenantId, tenantId), inArray(groupVisits.visitRequestId, ids)));
          if (groupVisitRows.length > 0) {
            await tx
              .update(groupMembers)
              .set({
                // memberName is NOT NULL — sentinel, mirroring visitRequests.visitorName.
                memberName: PURGED_SENTINEL,
                identityDocRef: null,
              })
              .where(
                and(
                  eq(groupMembers.tenantId, tenantId),
                  inArray(
                    groupMembers.groupVisitId,
                    groupVisitRows.map((r) => r.id),
                  ),
                ),
              );
          }

          // ── vehicle_passes.driverName / print_jobs.renderedPayload
          // (both via digital_passes.visitRequestId) ────────────────────
          const passRows = await tx
            .select({ id: digitalPasses.id, revoked: digitalPasses.revoked })
            .from(digitalPasses)
            .where(and(eq(digitalPasses.tenantId, tenantId), inArray(digitalPasses.visitRequestId, ids)));
          if (passRows.length > 0) {
            const passIds = passRows.map((r) => r.id);
            await tx
              .update(vehiclePasses)
              .set({ driverName: null })
              .where(and(eq(vehiclePasses.tenantId, tenantId), inArray(vehiclePasses.passId, passIds)));
            await tx
              .update(printJobs)
              .set({ renderedPayload: null })
              .where(and(eq(printJobs.tenantId, tenantId), inArray(printJobs.passId, passIds)));
          }

          // ── ocr_results (no FK to visit_requests — matched by
          // identityDocHash; see file header) ───────────────────────────
          const targetHashes = new Set(
            eligible
              .filter((r) => !!r.identityDocRef)
              .map((r) => identityDocHash(r.identityDocRef!, r.identityDocType)),
          );
          if (targetHashes.size > 0) {
            const tenantOcrResults = await tx
              .select({ id: ocrResults.id, idDocumentNumber: ocrResults.idDocumentNumber, idDocumentType: ocrResults.idDocumentType })
              .from(ocrResults)
              .where(eq(ocrResults.tenantId, tenantId));
            const matchingOcrIds = tenantOcrResults
              .filter((r) => !!r.idDocumentNumber && targetHashes.has(identityDocHash(r.idDocumentNumber!, r.idDocumentType)))
              .map((r) => r.id);
            if (matchingOcrIds.length > 0) {
              await tx
                .update(ocrResults)
                .set({
                  fullName: null,
                  dateOfBirth: null,
                  idDocumentNumber: null,
                  address: null,
                })
                .where(and(eq(ocrResults.tenantId, tenantId), inArray(ocrResults.id, matchingOcrIds)));
            }
          }

          return {
            photoRefsToDelete: eligible.filter((r) => !!r.photoRef).map((r) => r.photoRef!),
            passIdsToRevoke: passRows.filter((r) => !r.revoked).map((r) => r.id),
          };
        }),
      );

      purgedByTenant[tenantId] = ids.length;
      purgedCount += ids.length;

      // ── Post-commit best-effort side effects ────────────────────────
      // Never fail an already-committed purge for these — they mirror the
      // graceful-degradation convention used elsewhere in this service
      // (Redis revocation-set sync, roster sync, cache invalidate, etc.):
      // the PII cascade above is already durably committed to Postgres.

      // Delete the orphaned photo blob from S3/MinIO (reusing
      // document-scan/image-cleanup.ts's own client/approach) — the DB
      // pointer is already nulled by the UPDATE above, so this must run
      // with the photoRef captured BEFORE that UPDATE (eligible, above).
      for (const photoRef of photoRefsToDelete) {
        try {
          await deleteFromStorage(photoRef);
        } catch (err) {
          logger?.warn(
            { err, tenantId, photoRef, event: "dpdp_purge_photo_delete_failed" },
            "DPDP purge: failed to delete purged visitor's photo blob from storage",
          );
        }
      }

      // Revoke any still-active digital pass belonging to a purged visit
      // request, via digital-pass's own passRevoke() command publisher
      // (commands.ts) — not a hand-written UPDATE — so revocation stays
      // consistent with however digital-pass's consumer tracks it
      // elsewhere (Redis revocation set, outboxed passRevoked event).
      if (passIdsToRevoke.length > 0) {
        const ctx: RequestContext = {
          tenantId,
          actorId: SYSTEM_ACTOR,
          actorType: "service_account",
          roles: [],
          correlationId: randomUUID(),
        };
        for (const passId of passIdsToRevoke) {
          try {
            await passRevoke(ctx, { passId, reason: "dpdp_erasure" });
          } catch (err) {
            logger?.warn(
              { err, tenantId, passId, event: "dpdp_purge_pass_revoke_failed" },
              "DPDP purge: failed to publish pass revocation for a purged visitor's digital pass",
            );
          }
        }
      }
    } catch (err) {
      logger?.warn(
        { err, tenantId, event: "dpdp_purge_tenant_failed" },
        `DPDP purge failed for tenant=${tenantId}`,
      );
    }
  }

  logger?.info(
    { purgedCount, purgedByTenant, event: "dpdp_purge_cycle_complete" },
    `DPDP purge cycle: ${purgedCount} visit records purged of PII across ${Object.keys(purgedByTenant).length} tenant(s)`,
  );

  return { purgedCount, purgedByTenant };
}
