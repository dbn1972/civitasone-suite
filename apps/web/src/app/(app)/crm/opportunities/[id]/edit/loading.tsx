import { SkeletonBar } from "@/app/_components/ds/Skeleton";
import { useTranslations } from "next-intl";
export default function Loading() {
  const t = useTranslations("crm.loading");
  return (
    <div className="page-main">
      <div className="ph">
        <div>
          <h1 id="page-heading">{t("editOpportunityTitle")}</h1>
        </div>
      </div>
      {/* The page is a single form card — mirror that shape, not a tile grid. */}
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <SkeletonBar h={420} style={{ borderRadius: 12 }} />
      </div>
    </div>
  );
}
