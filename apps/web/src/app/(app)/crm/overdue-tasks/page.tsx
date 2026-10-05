import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { OverdueTaskAlerts } from "../../../_components/crm/OverdueTaskAlerts";

/**
 * AC-005 — overdue-task monitoring, split out of the admin-only Task Escalation
 * route so the managers who RECEIVE escalations can watch what is overdue
 * without holding crm_admin (GAP-CRM-TASK-ESCALATION-03). This route inherits
 * the broad CRM layout guard (crm_user+), unlike /crm/task-escalation which
 * stays admin-only for the rule editor. The API remains the authority and
 * scopes rows to what the caller may see.
 */
export default async function Page() {
  const t = await getTranslations("crmOverdueTasksPage");
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm"
        backLabel={t("backLabel")}
      />
      <OverdueTaskAlerts />
    </>
  );
}
