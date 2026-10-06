import { getTranslations } from "next-intl/server";
import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getThemeBranding } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("themes");
  const { data, source } = await getThemeBranding();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <ModuleListPage
        title={t("brandingPageTitle")}
        description={t("brandingPageSubtitle")}
        cacheKey="module.themes-branding"
        rows={data}
        source={source}
        back="/themes"
        backLabel="Themes"
        errorArea="branding packs"
      />
    </div>
  );
}
