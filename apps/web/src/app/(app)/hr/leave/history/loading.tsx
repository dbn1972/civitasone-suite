import { SkeletonBar } from "@/app/_components/ds/Skeleton";
import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("msg");
  return (
    <div className="page-main wrap" aria-label={t("loading")} aria-busy="true">
      <SkeletonBar h={48} style={{ maxWidth: 400, borderRadius: 8, margin: "24px 0 8px" }} />
      <SkeletonBar h={20} style={{ maxWidth: 260, borderRadius: 4, marginBottom: 24 }} />
      <SkeletonBar h={120} style={{ borderRadius: 10, marginBottom: 12 }} />
      <SkeletonBar h={300} style={{ borderRadius: 10 }} />
    </div>
  );
}
