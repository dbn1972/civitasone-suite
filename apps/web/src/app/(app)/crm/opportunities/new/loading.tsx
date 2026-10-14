import { SkeletonBar } from "@/app/_components/ds/Skeleton";
import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("crmOpportunityNewLoading");
  return (
    <div className="page-main">
      <div className="ph">
        <div>
          <h1 id="page-heading">{t("title")}</h1>
        </div>
      </div>
      {/* The page is a single form card, not a tile dashboard — mirror that shape. */}
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <SkeletonBar h={420} style={{ borderRadius: 12 }} />
      </div>
    </div>
  );
}
