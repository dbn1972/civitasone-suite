import { PageHeader } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";

// GAP-HR-SOCIAL-FEED-05: this used to render a raw `<div className="ph">`
// with a plain `<h1>` instead of the shared PageHeader every sibling
// loading.tsx uses, so the header chrome (back link, spacing) didn't match
// the loaded page and shifted on load.
export default async function Loading() {
  const t = await getTranslations("socialFeed");
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("loadingSubtitle")} back="/hr" backLabel={t("backToHr")} />
      <div className="animate-pulse" style={{ display: "grid", gap: 16 }}>
        <div style={{ height: 120, borderRadius: 12, background: "var(--bg, #f1f5f9)" }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ height: 80, borderRadius: 12, background: "var(--bg, #f1f5f9)" }} />
          ))}
        </div>
        <div style={{ height: 240, borderRadius: 12, background: "var(--bg, #f1f5f9)" }} />
      </div>
    </div>
  );
}
