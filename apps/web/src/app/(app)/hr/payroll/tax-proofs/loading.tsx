import { SkeletonBar } from "@/app/_components/ds/Skeleton";
import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("taxProofs");
  return (
    <div className="page-main">
      <div className="ph">
        <div>
          <h1 id="page-heading">{t("queue.title")}</h1>
          <div className="sub">{t("loading")}</div>
        </div>
      </div>
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <SkeletonBar h={240} style={{ borderRadius: 12 }} />
        <SkeletonBar h={160} style={{ borderRadius: 12 }} />
      </div>
    </div>
  );
}
