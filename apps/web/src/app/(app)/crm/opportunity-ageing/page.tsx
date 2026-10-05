import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { StageAgeingDashboard } from "../../../_components/crm/StageAgeingDashboard";
import { getSessionRoles, hasAnyRole, CRM_CONFIG_ADMIN_ROLES } from "@/lib/auth/roleGuard";

/** OP-005 — opportunities exceeding their stage day-limit + limits config. */
export default async function Page() {
  const t = await getTranslations("crmOpportunityAgeingPage");
  // GAP-CRM-OPPORTUNITY-AGEING-05: the ageing list is useful to every manager, but
  // editing the per-stage limits (which drive the alert tenant-wide) is admin-only.
  const canConfig = hasAnyRole(getSessionRoles(), CRM_CONFIG_ADMIN_ROLES);
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm"
        backLabel={t("backLabel")}
      />
      <StageAgeingDashboard canConfig={canConfig} />
    </>
  );
}
