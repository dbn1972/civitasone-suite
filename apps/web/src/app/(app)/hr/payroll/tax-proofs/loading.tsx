import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const t = await getTranslations("taxProofs");
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <div className="ph">
        <div>
          <h1 id="page-heading">{t("queue.title")}</h1>
          <div className="sub">{t("loading")}</div>
        </div>
      </div>
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <div style={{ height: 240, borderRadius: 12, background: "var(--bg, #f1f5f9)" }} />
        <div style={{ height: 160, borderRadius: 12, background: "var(--bg, #f1f5f9)" }} />
      </div>
    </div>
  );
}
