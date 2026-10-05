/**
 * GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05 — citizen feedback repository.
 */
import { eq, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { citizenFeedback, type CitizenFeedbackInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "delete" | "select">;

export async function insert(tx: Writer, row: CitizenFeedbackInsert): Promise<void> {
  await tx.insert(citizenFeedback).values(row);
}

export interface RatingsSummary {
  /** Mean rating 1-5, rounded to 2 dp, or null when there are no ratings. */
  average: number | null;
  count: number;
}

/**
 * Average + count of a tenant's citizen ratings. No comment text is read here —
 * the tile needs only the aggregate, never the (PII) free text.
 */
export async function ratingsSummary(tenantId: string): Promise<RatingsSummary> {
  const rows = await scopedRead((tx) =>
    tx
      .select({
        avg: sql<string | null>`avg(${citizenFeedback.rating})`,
        count: sql<number>`count(*)::int`,
      })
      .from(citizenFeedback)
      .where(eq(citizenFeedback.tenantId, tenantId)),
  );
  const count = rows[0]?.count ?? 0;
  const avgRaw = rows[0]?.avg;
  const average = count > 0 && avgRaw != null ? Math.round(Number(avgRaw) * 100) / 100 : null;
  return { average, count };
}

export interface FeedbackView {
  id: string;
  rating: number;
  comment: string | null;
  serviceRequestId: string | null;
  submissionType: string;
  createdAt: string;
}

/**
 * Admin-only list of individual feedback (incl. the comment). The route gates
 * this on CRM admin roles; callers outside those roles must never reach it.
 */
export async function listForAdmin(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: FeedbackView[]; total: number }> {
  return scopedRead(async (tx) => {
    const where = eq(citizenFeedback.tenantId, tenantId);
    const rows = await tx
      .select()
      .from(citizenFeedback)
      .where(where)
      .orderBy(desc(citizenFeedback.createdAt))
      .limit(limit)
      .offset(offset);
    const counted = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(citizenFeedback)
      .where(where);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        serviceRequestId: r.serviceRequestId,
        submissionType: r.submissionType,
        createdAt: r.createdAt.toISOString(),
      })),
      total: counted[0]?.count ?? 0,
    };
  });
}
