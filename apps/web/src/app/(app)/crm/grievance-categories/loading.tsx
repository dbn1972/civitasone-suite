import { useTranslations } from "next-intl";

export default function Loading() {
  const t = useTranslations("crmGrievanceCategoriesLoading");
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <div className="ph">
        <div>
          <h1 id="page-heading">{t("heading")}</h1>
        </div>
      </div>
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <div style={{ height: 280, borderRadius: 12, background: "#f1f5f9" }} />
      </div>
    </div>
  );
}
