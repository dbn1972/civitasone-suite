import { SkeletonTable, SkeletonCard } from "../../../_components/ds";
import { PageHeader } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";

/**
 * Skeleton for AttendancePage (server component). Shown by Next.js Suspense
 * while the page awaits getAttendanceList(). Prevents the empty-state flash
 * (W5).
 *
 * GAP-HR-ATTENDANCE-07: this used to render only the records-table skeleton,
 * so the four stat cards and the geo check-in card popped in abruptly once
 * data arrived instead of having their own placeholder. Adds a stat-card
 * grid (mirrors the real page's StatGrid) and a card-height block (mirrors
 * the real GeoCheckInCard) above the existing table skeleton.
 */
export default async function AttendanceLoading() {
  const t = await getTranslations("attendance");
  return (
    <div className="page-main wrap" aria-busy="true">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div
        aria-hidden="true"
        style={{ height: 140, borderRadius: 12, background: "var(--panel)", border: "1px solid var(--line)", marginBottom: 16 }}
      />
      <SkeletonTable rows={8} />
    </div>
  );
}
