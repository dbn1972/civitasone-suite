/**
 * Voice-of-Customer routes (P2-6).
 * GET /v1/crm/sentiment/summary — aggregate: polarity mix, average score, top themes
 * GET /v1/crm/sentiment         — the underlying scored interactions
 * GET /v1/crm/sentiment/export  — audited CSV export of the scored interactions (F2-06)
 *
 * There is no write route on purpose: a reading exists because an interaction was
 * logged, and the sentiment consumer is the only thing that produces one. Scoring
 * is not something an operator should be able to assert by hand.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  resolveContext,
  requireRole,
  HttpError,
} from "../../shared/context.js";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import { POLARITIES } from "./domain.js";
import { rowsToCsv, exportFilename, type CsvColumn } from "../../shared/csv-export.js";
import { auditBulkExport } from "../../shared/export-audit.js";
import type { InteractionSentimentView } from "./schema.js";
import * as queries from "./queries.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

/** Mirrors the web gate (CRM_VIGILANCE_ROLES in apps/web roleGuard.ts). */
export const CRM_VIGILANCE_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];

const polarityEnum = z.enum(["positive", "neutral", "negative"]);

const filterQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  polarity: polarityEnum.optional(),
  activityType: z.string().min(1).max(16).optional(),
});

const listSentimentQuery = listQuery.merge(filterQuery);

const exportSentimentQuery = filterQuery.extend({
  purpose: z.string().trim().min(10).max(500),
});

/** Hard ceiling on a single export. */
const EXPORT_CAP = 5000;

const EXPORT_COLUMNS: CsvColumn<InteractionSentimentView>[] = [
  { header: "Analysed At", value: (r) => r.analysedAt },
  { header: "Activity Type", value: (r) => r.activityType },
  { header: "Polarity", value: (r) => r.polarity },
  { header: "Score", value: (r) => r.score },
  { header: "Themes", value: (r) => (r.themes ?? []).join("; ") },
  { header: "Excerpt", value: (r) => r.excerpt },
  { header: "Model", value: (r) => r.model },
];

/**
 * An inverted range silently returns nothing, which reads as "no complaints" —
 * the most dangerous possible wrong answer for this screen. Reject it instead.
 */
function assertOrderedRange(from?: string, to?: string): void {
  if (from && to && new Date(from) > new Date(to)) {
    throw new HttpError(
      400,
      "INVALID_RANGE",
      `'from' (${from}) must not be after 'to' (${to})`,
    );
  }
}

function canSeeSensitive(ctx: RequestContext): boolean {
  return hasAnyRole(ctx, CRM_VIGILANCE_ROLES);
}

export async function sentimentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/sentiment/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = filterQuery.parse(req.query ?? {});
    assertOrderedRange(q.from, q.to);

    const summary = await queries.getVocSummary(ctx.tenantId, { ...q, excludeSensitive: !canSeeSensitive(ctx) });
    return reply.send({ data: { ...summary, polarities: POLARITIES } });
  });

  app.get("/v1/crm/sentiment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listSentimentQuery.parse(req.query ?? {});
    assertOrderedRange(q.from, q.to);
    const w = windowOf(q);

    const { rows, total } = await queries.listSentiments(
      ctx.tenantId,
      w.pageSize,
      w.offset,
      { ...q, excludeSensitive: !canSeeSensitive(ctx) },
    );
    return reply.send(listEnvelope(rows, w, total));
  });
  // F2-06: audited CSV export of the scored interactions, with the same vigilance
  // filter as the list. CSV is returned directly (not a client Blob) and the bulk
  // egress is recorded with the caller's stated purpose.
  app.get("/v1/crm/sentiment/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = exportSentimentQuery.parse(req.query ?? {});
    assertOrderedRange(q.from, q.to);

    const canSeeVigilance = canSeeSensitive(ctx);
    const { rows } = await queries.listSentiments(
      ctx.tenantId,
      EXPORT_CAP,
      0,
      { from: q.from, to: q.to, polarity: q.polarity, activityType: q.activityType, excludeSensitive: !canSeeVigilance },
    );
    const csv = rowsToCsv(EXPORT_COLUMNS, rows);

    await auditBulkExport(ctx, {
      resourceType: "interaction_sentiment",
      action: "sentiment_bulk_export",
      rowCount: rows.length,
      purpose: q.purpose,
      filters: {
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
        ...(q.polarity ? { polarity: q.polarity } : {}),
        ...(q.activityType ? { activityType: q.activityType } : {}),
      },
      masked: !canSeeVigilance,
    });

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${exportFilename("voice-of-customer")}"`);
    return reply.send(csv);
  });
}
