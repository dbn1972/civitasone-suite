import { SkeletonBar } from "@/app/_components/ds/Skeleton";
import { getTranslations } from "next-intl/server";

// GAP-HR-DISCIPLINARY-DETAIL-07 (I18N): was hard-coded English while the
// rest of the page uses next-intl. A Next.js `loading.tsx` special file can
// be an async Server Component, same as the page itself.
export default async function Loading() {
  const t = await getTranslations("disciplinaryDetail");
  return (
    <div className="page-main">
      <div className="ph">
        <div>
          <h1 id="page-heading">{t("loadingTitle")}</h1>
          <div className="sub">{t("loadingSub")}</div>
        </div>
      </div>
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <SkeletonBar h={120} style={{ borderRadius: 12 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ height: 80, borderRadius: 12, background: "var(--line2)" }} />
          ))}
        </div>
        <SkeletonBar h={240} style={{ borderRadius: 12 }} />
      </div>
    </div>
  );
}
