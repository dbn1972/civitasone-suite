import { notFound } from "next/navigation";
import { ModuleListPage } from "../../../../_components/ModuleListPage";
import { getTenantCodeListValues } from "../../_data";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

// GAP-TENANT-CODE-LISTS-01: read-only drill-down of one code list's
// effective-dated values (the list page links each row here).
export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const t = await getTranslations("tenantPages");
  const result = await getTenantCodeListValues(code);
  // An unknown list is a not-found, distinct from a failed load (error state below).
  if (result.source === "error" && result.status === 404) notFound();
  return (
    <div className="page-main">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/tenant/code-lists">{t("codeListsBack")}</a>
      </nav>
      <ModuleListPage
        title={`${t("codeValuesTitle")} — ${code}`}
        description={t("codeValuesSubtitle")}
        rows={result.data}
        showId={false}
        cacheKey={`module.office-code-list-values.${code}`}
        source={result.source}
        errorArea="code list values"
      />
    </div>
  );
}
