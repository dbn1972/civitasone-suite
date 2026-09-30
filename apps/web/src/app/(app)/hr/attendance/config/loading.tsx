import { PageHeader } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";

/**
 * GAP-HR-ATTENDANCE-CONFIG-05: this used to show its own hand-written
 * "Attendance Config" / "Configure attendance rules and period locks."
 * heading (loadingTitle/loadingSubtitle) -- wording for a DIFFERENT,
 * editable-sounding page than the real one ("Attendance Rules" / "...
 * read-only reference") -- built from hand-rolled `.ph` markup placed
 * OUTSIDE `.page-main.wrap` (a sibling of it, not inside), instead of the
 * shared PageHeader component every other loading.tsx in this module uses,
 * with a skeleton shape (a 120px banner, four 80px stat tiles, one 240px
 * block) that matched none of the real page's actual layout (a notice
 * banner + a 2x2 grid of four cards) -- so both the copy and the header
 * alignment jumped once real content arrived.
 *
 * Now reuses the real page's own title/subtitle keys via the real
 * PageHeader component inside `page-main wrap` (so the two pages can never
 * drift again, in wording or in layout), with a skeleton shape that mirrors
 * the real layout: a notice-bar placeholder, then a 2x2 grid of four
 * card-height blocks (Working Hours / Late Mark Rules / Overtime Rules /
 * Comp-Off).
 */
export default async function Loading() {
  const t = await getTranslations("attendanceConfig");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading" aria-busy="true">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/attendance" backLabel={t("backLabel")} />
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <div style={{ height: 60, borderRadius: 12, background: "var(--bg, #f1f5f9)" }} />
        <div className="grid g-2" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ height: 180, borderRadius: 12, background: "var(--bg, #f1f5f9)" }} />
          ))}
        </div>
      </div>
    </div>
  );
}
