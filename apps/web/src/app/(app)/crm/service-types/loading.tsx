import { SkeletonBar } from "@/app/_components/ds/Skeleton";
import { useTranslations } from "next-intl";

export default function Loading() {
  const t = useTranslations("crmServiceTypesLoading");
  return (
    <div className="page-main">
      <div className="ph">
        <div>
          <div data-skeleton-heading="">{t("title")}</div>
        </div>
      </div>
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <SkeletonBar h={280} style={{ borderRadius: 12 }} />
      </div>
    </div>
  );
}
