import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { TaskEscalationEditor } from "../../../_components/crm/TaskEscalationEditor";

/**
 * AC-005 — task-escalation CONFIGURATION. Admin-only via this route's own
 * layout.tsx. The overdue-task MONITORING list used to live here too, which
 * meant a manager without crm_admin could not see it; it now has its own
 * manager-visible route at /crm/overdue-tasks (GAP-CRM-TASK-ESCALATION-03).
 */
export default async function Page() {
  const t = await getTranslations("crmTaskEscalationPage");
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm"
        backLabel={t("backLabel")}
      />
      <div style={{ display: "grid", gap: 18 }}>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
          {t("watchingOverduePrefix")} <a href="/crm/overdue-tasks">{t("overdueTasksLink")}</a> {t("watchingOverdueSuffix")}
        </p>
        <TaskEscalationEditor />
      </div>
    </>
  );
}
