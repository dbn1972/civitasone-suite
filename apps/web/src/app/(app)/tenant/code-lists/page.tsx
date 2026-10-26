import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantCodeLists } from "../_data";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("tenantPages");
  const { data, source } = await getTenantCodeLists();
  return (
    <div className="page-main">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/tenant">{t("office")}</a>
      </nav>
      <ModuleListPage
        title={t("codeListsTitle")}
        description={t("codeListsSubtitle")}
        rows={data}
        showId={false}
        detailHrefBase="/tenant/code-lists"
        // Pinned: the title is translated, so the offline cache key must not derive from it.
        cacheKey="module.office-code-lists"
        source={source}
        errorArea="code lists"
      />
    </div>
  );
}
