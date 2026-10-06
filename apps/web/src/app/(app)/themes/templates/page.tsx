import { getTranslations } from "next-intl/server";
import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getThemeTemplates } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("themes");
  const { data, source } = await getThemeTemplates();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <ModuleListPage
        title={t("templatesPageTitle")}
        description={t("templatesPageSubtitle")}
        cacheKey="module.themes-templates"
        rows={data}
        source={source}
        back="/themes"
        backLabel="Themes"
        errorArea="theme templates"
      />
    </div>
  );
}
