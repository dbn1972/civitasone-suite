import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("crmOpportunityNewLoading");
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <div className="ph">
        <div>
          <h1 id="page-heading">{t("title")}</h1>
        </div>
      </div>
      {/* The page is a single form card, not a tile dashboard — mirror that shape. */}
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <div style={{ height: 420, borderRadius: 12, background: "#f1f5f9" }} />
      </div>
    </div>
  );
}
