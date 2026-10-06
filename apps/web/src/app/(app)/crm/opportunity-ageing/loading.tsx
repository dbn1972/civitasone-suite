import { useTranslations } from "next-intl";
export default function Loading() {
  const t = useTranslations("crm.loading");
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <div className="ph">
        <div>
          {/* GAP-CRM-OPPORTUNITY-AGEING-06: the heading must match the loaded
              page title ("Stage Ageing"), not "Opportunity Ageing", so there is
              no title flip when the data arrives. */}
          <h1 id="page-heading">{t("stageAgeingTitle")}</h1>
        </div>
      </div>
      {/* The page renders two cards (breaches + stage day limits), not a stat-tile
          grid — mirror that shape so there is no layout shift on load. */}
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <div style={{ height: 220, borderRadius: 12, background: "#f1f5f9" }} />
        <div style={{ height: 260, borderRadius: 12, background: "#f1f5f9" }} />
      </div>
    </div>
  );
}
