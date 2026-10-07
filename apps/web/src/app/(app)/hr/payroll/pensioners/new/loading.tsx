import { getTranslations } from "next-intl/server";
import { SkeletonBar } from "../../../../../_components/ds/Skeleton";

// GAP-PAYROLL-PENSIONERS-NEW-05: this used to draw the LIST page's skeleton
// (stat tiles + a table block) for what is a single-card form page. It now
// mirrors the form itself: one card, maxWidth 640, with label + input rows.
export default async function Loading() {
  const t = await getTranslations("pensionersNew");
  return (
    <div className="page-main wrap">
      <div className="ph">
        <div>
          <h1 id="page-heading">{t("loadingHeading")}</h1>
          <div className="sub">{t("loadingSub")}</div>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 640 }} aria-busy="true" aria-label={t("loadingHeading")}>
        <div className="pad" style={{ display: "grid", gap: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "grid", gap: 6 }}>
              <SkeletonBar w={140} h={12} />
              <SkeletonBar h={44} />
            </div>
          ))}
          <SkeletonBar w={160} h={44} />
        </div>
      </div>
    </div>
  );
}
