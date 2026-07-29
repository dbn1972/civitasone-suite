import { eq, and } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { hrmsOffers, hrmsApplications } from "./schema.js";

export interface AnalyticsOffer {
  status: string;
  releasedAt: Date | null;
  acceptedAt: Date | null;
  declineReasonCode: string | null;
}

const COLS = {
  status: hrmsOffers.status,
  releasedAt: hrmsOffers.releasedAt,
  acceptedAt: hrmsOffers.acceptedAt,
  declineReasonCode: hrmsOffers.declineReasonCode,
};

/** Offers for analytics, optionally scoped to one job opening (via the application). */
export async function listOffersForAnalytics(tenantId: string, jobOpeningId?: string): Promise<AnalyticsOffer[]> {
  return scopedRead((tx) => {
    if (jobOpeningId) {
      return tx.select(COLS).from(hrmsOffers)
        .innerJoin(hrmsApplications, eq(hrmsOffers.applicationId, hrmsApplications.id))
        .where(and(eq(hrmsOffers.tenantId, tenantId), eq(hrmsApplications.jobOpeningId, jobOpeningId)));
    }
    return tx.select(COLS).from(hrmsOffers).where(eq(hrmsOffers.tenantId, tenantId));
  });
}
