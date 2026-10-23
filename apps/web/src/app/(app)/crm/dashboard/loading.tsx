import { SkeletonBar } from "@/app/_components/ds/Skeleton";
import { useTranslations } from "next-intl";
export default function Loading() {
  const t = useTranslations("crm.loading");
  return (
    <div className="page-main">
      <div className="ph">
        <div>
          {/* GAP-CRM-DASHBOARD-03: same h1 the loaded page shows (crm.dashboard.title
              default) so the heading does not flip from "Dashboard" to the real
              title on paint. */}
          <div data-skeleton-heading="">{t("dashboardTitle")}</div>
        </div>
      </div>
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ height: 80, borderRadius: 12, background: "var(--line2)" }} />
          ))}
        </div>
        <SkeletonBar h={280} style={{ borderRadius: 12 }} />
      </div>
    </div>
  );
}
