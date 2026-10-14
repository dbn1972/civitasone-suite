import { SkeletonBar } from "@/app/_components/ds/Skeleton";
import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("msg");
  return (
    <div className="page-main wrap" style={{ animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }} role="status" aria-live="polite" aria-label={t("loading")}>
      <div style={{ marginBottom: 24 }}>
        <SkeletonBar w={160} h={16} style={{ borderRadius: 4, marginBottom: 8 }} />
        <SkeletonBar w={256} h={32} style={{ borderRadius: 4 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
        {[0, 1, 2, 3].map((i) => (<div key={i} style={{ height: 96, borderRadius: 12, background: "var(--line2)" }} />))}
      </div>
      <SkeletonBar h={200} style={{ borderRadius: 12, marginTop: 18 }} />
      <SkeletonBar h={200} style={{ borderRadius: 12, marginTop: 18 }} />
    </div>
  );
}
