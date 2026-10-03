import { PageHeader } from "../../../_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canManageAssetCapitalisation, canManageAssetSettings } from "@/lib/auth/workRoles";
import { getTranslations } from "next-intl/server";
import { SettingsPanel } from "./SettingsPanel";

/** Asset settings: the GL accounts capitalisation / leases post to (no defaults) and the two-person capitalisation control. */
export default async function AssetSettingsPage() {
  const t = await getTranslations("assetsGl");
  const roles = getSessionRoles();
  return (
    <>
      <PageHeader title={t("settingsTitle")} subtitle={t("settingsSubtitle")} back="/assets" backLabel="Assets" />
      <SettingsPanel canManage={canManageAssetSettings(roles)} canManageCapitalisation={canManageAssetCapitalisation(roles)} />
    </>
  );
}
