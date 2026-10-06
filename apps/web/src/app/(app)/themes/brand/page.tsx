import { getTranslations } from "next-intl/server";
import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getThemeBrand } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("themes");
  const { data, source } = await getThemeBrand();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <ModuleListPage
        title={t("brandPageTitle")}
        description={t("brandPageSubtitle")}
        cacheKey="module.themes-brand"
        rows={data}
        source={source}
        back="/themes"
        backLabel="Themes"
        errorArea="brand presets"
      />
    </div>
  );
}
