/**
 * Automatic email & calendar activity capture (AC-004, WC-003) plus the
 * capture-health report (WC-004).
 *
 * POST /v1/crm/activities/capture           — ingest a captured item (202, idempotent)
 * GET  /v1/crm/activities/capture           — list (matchStatus filter)
 * GET  /v1/crm/activities/capture/health    — counts by matchStatus + match rate
 * POST /v1/crm/activities/capture/:id/match — manually attach to a contact
 *
 * DPDP / PII stance (deliberate — do not "improve" by storing more):
 *   We persist NO message body. Only the subject line, the participant handles
 *   the connector supplies, and `rawRef` — an opaque pointer back to the source
 *   system. That keeps the CRM's personal-data footprint minimal under the DPDP
 *   Act 2023 and makes erasure a single-row delete. Participant handles are also
 *   never written to logs: log lines carry the capture id and counts only.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { scopedRead } from "../../shared/db.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand } from "../../shared/residual-publish.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const CAPTURE_SOURCES = ["email", "calendar"] as const;
const MATCH_STATUSES = ["matched", "unmatched", "ambiguous"] as const;

export type MatchStatus = (typeof MATCH_STATUSES)[number];

/** Basis points per whole unit — the match rate is reported as an integer. */
const BPS_SCALE = 10_000;

const idParam = z.object({ id: z.string().uuid() });

const captureBody = z.object({
  source: z.enum(CAPTURE_SOURCES),
  externalId: z.string().min(1).max(200),
  subject: z.string().max(500).optional(),
  occurredAt: z.string().datetime().optional(),
  /** Opaque participant handles from the connector. Never logged. */
  participants: z.array(z.string().min(1).max(320)).max(100).default([]),
  /**
   * Contacts the connector believes this item belongs to. Zero → unmatched,
   * one → matched, many → ambiguous (a human decides via /match).
   */
  candidateContactIds: z.array(z.string().uuid()).max(20).default([]),
  /** Pointer to the source message. NEVER the body itself. */
  rawRef: z.string().max(500).optional(),
});

const matchBody = z.object({
  contactId: z.string().uuid(),
});

const listCaptureQuery = listQuery.extend({
  matchStatus: z.enum(MATCH_STATUSES).optional(),
  source: z.enum(CAPTURE_SOURCES).optional(),
});

const SELECT_COLUMNS = sql`
  id,
  source,
  external_id      AS "externalId",
  contact_id       AS "contactId",
  subject,
  occurred_at      AS "occurredAt",
  participants,
  match_confidence AS "matchConfidence",
  match_status     AS "matchStatus",
  raw_ref          AS "rawRef",
  created_at       AS "createdAt",
  updated_at       AS "updatedAt",
  version
`;

type CaptureRow = Record<string, unknown>;

export interface MatchResolution {
  matchStatus: MatchStatus;
  contactId: string | null;
  /** Confidence in [0,1] with 4 decimal places (numeric(5,4) in the DB). */
  confidence: string;
}

/**
 * Pure match resolution from connector-supplied candidates.
 * One candidate is a confident match; several mean a human must disambiguate;
 * none means the item sits in the unmatched queue that WC-004 measures.
 */
export function resolveMatch(candidateContactIds: readonly string[]): MatchResolution {
  const unique = Array.from(new Set(candidateContactIds));
  if (unique.length === 1) {
    return { matchStatus: "matched", contactId: unique[0] ?? null, confidence: "1.0000" };
  }
  if (unique.length > 1) {
    // Split confidence evenly across candidates — enough signal to rank the
    // ambiguous queue without pretending we know the answer.
    const confidence = (1 / unique.length).toFixed(4);
    return { matchStatus: "ambiguous", contactId: null, confidence };
  }
  return { matchStatus: "unmatched", contactId: null, confidence: "0.0000" };
}

export async function captureRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Ingest a captured item. Idempotent on (tenant, source, externalId): connectors
   * re-deliver freely, and a replay returns the original capture id with
   * `deduplicated: true` instead of creating a second row.
   */
  app.post("/v1/crm/activities/capture", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = captureBody.parse(req.body);

    const resolution = resolveMatch(body.candidateContactIds);

    // Idempotent read: if (tenant,source,externalId) already exists, accept without re-publish.
    const existing = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, match_status AS "matchStatus" FROM crm.captured_activities
        WHERE tenant_id = ${ctx.tenantId} AND source = ${body.source} AND external_id = ${body.externalId}
      `) as unknown as Array<{ id: string; matchStatus: string }>;
    });
    if (existing[0]) {
      return reply.code(202).send({
        id: existing[0].id,
        status: "accepted",
        deduplicated: true,
        matchStatus: existing[0].matchStatus,
        correlationId: ctx.correlationId,
      });
    }

    const capturedId = commandId(ctx, COMMANDS.captureActivity);
    const accepted = await publishCrmCommand(ctx, COMMANDS.captureActivity, capturedId, {
      capturedId,
      source: body.source,
      externalId: body.externalId,
      contactId: resolution.contactId,
      subject: body.subject ?? null,
      occurredAt: body.occurredAt ?? null,
      participants: body.participants,
      matchConfidence: resolution.confidence,
      matchStatus: resolution.matchStatus,
      participantCount: body.participants.length,
      rawRef: body.rawRef ?? null,
    });
    return reply.code(202).send({
      id: accepted.id,
      status: "accepted",
      deduplicated: false,
      matchStatus: resolution.matchStatus,
      correlationId: accepted.correlationId,
    });
  });

  /** List captured items. */
  app.get("/v1/crm/activities/capture", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listCaptureQuery.parse(req.query ?? {});
    const w = windowOf(q);

    const statusFilter = q.matchStatus ? sql`AND match_status = ${q.matchStatus}` : sql``;
    const sourceFilter = q.source ? sql`AND source = ${q.source}` : sql``;

    const { rows, total } = await scopedRead(async (tx) => {
      const data = await tx.execute(sql`
        SELECT ${SELECT_COLUMNS}
        FROM crm.captured_activities
        WHERE tenant_id = ${ctx.tenantId} ${statusFilter} ${sourceFilter}
        ORDER BY occurred_at DESC NULLS LAST, created_at DESC
        LIMIT ${w.pageSize} OFFSET ${w.offset}
      `) as unknown as CaptureRow[];
      const counted = await tx.execute(sql`
        SELECT count(*)::int AS total
        FROM crm.captured_activities
        WHERE tenant_id = ${ctx.tenantId} ${statusFilter} ${sourceFilter}
      `) as unknown as Array<{ total: number }>;
      return { rows: data, total: counted[0]?.total ?? 0 };
    });

    return reply.send(listEnvelope(rows, w, total));
  });

  /**
   * WC-004 capture health: how much of what we capture actually lands on a
   * contact. A falling match rate means the connector's identity data is drifting.
   */
  app.get("/v1/crm/activities/capture/health", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);

    const rows = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT match_status AS "matchStatus", count(*)::int AS count
        FROM crm.captured_activities
        WHERE tenant_id = ${ctx.tenantId}
        GROUP BY match_status
      `) as unknown as Array<{ matchStatus: string; count: number }>;
    });

    const byStatus: Record<MatchStatus, number> = { matched: 0, unmatched: 0, ambiguous: 0 };
    for (const r of rows) {
      if ((MATCH_STATUSES as readonly string[]).includes(r.matchStatus)) {
        byStatus[r.matchStatus as MatchStatus] = r.count;
      }
    }
    const total = byStatus.matched + byStatus.unmatched + byStatus.ambiguous;
    // Integer basis points, not a float percentage.
    const matchRateBps = total === 0 ? 0 : Math.round((byStatus.matched * BPS_SCALE) / total);

    return reply.send({
      data: {
        total,
        byStatus,
        matchRateBps,
        healthy: total === 0 ? true : matchRateBps >= 8000,
      },
    });
  });

  /** Manually attach a captured item to a contact. */
  app.post("/v1/crm/activities/capture/:id/match", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = matchBody.parse(req.body);

    const found = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, match_status AS "matchStatus", version FROM crm.captured_activities
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{ id: string; matchStatus: string; version: number }>;
    });
    const captured = found[0];
    if (!captured) {
      throw new HttpError(404, "NOT_FOUND", "captured activity not found");
    }

    const contactRows = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id FROM crm.contacts
        WHERE id = ${body.contactId} AND tenant_id = ${ctx.tenantId} AND status = 'active'
      `) as unknown as Array<{ id: string }>;
    });
    if (contactRows.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "contact not found");
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await publishCrmCommand(ctx, COMMANDS.matchCapturedActivity, id, {
        contactId: body.contactId,
        fromStatus: captured.matchStatus,
        version: captured.version,
      }),
    );
  });
}
