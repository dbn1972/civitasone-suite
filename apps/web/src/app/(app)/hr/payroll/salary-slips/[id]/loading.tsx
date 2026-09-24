import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("salarySlipDetail");
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <div className="ph">
        <div>
          <h1 id="page-heading">{t("title")}</h1>
          <div className="sub">{t("loadingSlipDetails")}</div>
        </div>
      </div>
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <div style={{ height: 120, borderRadius: 12, background: "var(--panel)" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ height: 80, borderRadius: 12, background: "var(--panel)" }} />
          ))}
        </div>
        <div style={{ height: 240, borderRadius: 12, background: "var(--panel)" }} />
      </div>
    </div>
  );
}
