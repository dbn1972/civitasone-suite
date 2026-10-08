import { getTranslations } from "next-intl/server";
import { PageHeader, LoadErrorState } from "../../../_components/ds";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { getThemeBrandConfig, getThemeBrandPresets } from "../_data";
import { BrandPreview, BrandPresetGallery } from "./BrandPresetGallery";

export const dynamic = "force-dynamic";

// GAP-THEMES-BRAND-01: brand activation is a tenant-wide visual change; the
// server enforces theme_admin/super_admin on POST /v1/themes/brand/apply-preset.
// Mirror that on the web so the Activate control is only offered to those roles
// (UI hiding + server enforcement, not UI hiding alone).
const BRAND_ADMIN_ROLES = ["theme_admin", "super_admin"];

export default async function Page() {
  const t = await getTranslations("themes");
  const [configResult, presetsResult] = await Promise.all([getThemeBrandConfig(), getThemeBrandPresets()]);
  const errored = configResult.source === "error" && presetsResult.source === "error";
  const canActivate = hasAnyRole(getSessionRoles(), BRAND_ADMIN_ROLES);

  return (
    <div className="page-main wrap">
      <PageHeader title={t("brandPageTitle")} subtitle={t("brandPageSubtitle")} back="/themes" backLabel="Themes" />
      {errored ? (
        <LoadErrorState result={configResult} area="brand presets" backHref="/themes" backLabel="Themes" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <BrandPreview config={configResult.data} />
          <BrandPresetGallery
            presets={presetsResult.data}
            canActivate={canActivate}
            activeHint={configResult.data?.colorPrimary ?? null}
          />
        </div>
      )}
    </div>
  );
}
