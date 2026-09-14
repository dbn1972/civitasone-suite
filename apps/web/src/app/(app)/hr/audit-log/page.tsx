import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, DataTable } from "@/app/_components/ds";
import { getHrAuditLog } from "@/app/_data/loaders";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function HrAuditLogPage() {
  const t = await getTranslations("hrAuditLog");
  const { data: events, source } = await getHrAuditLog();

  const rows = events.map((e, i) => ({
    id: String(i),
    action: e.action ?? "—",
    resource: e.resource ?? "—",
    actor: e.actor ?? "—",
    outcome: e.outcome ?? "—",
  }));

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <Card title={t("cardTitle")}>
        <DataTable
          columns={[
            { key: "action", label: t("colAction") },
            { key: "resource", label: t("colResource") },
            { key: "actor", label: t("colActor") },
            { key: "outcome", label: t("colOutcome") },
          ]}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={20}
          exportable
          exportFilename="hr-audit-log"
          emptyIcon="📋"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
      </Card>
    </>
  );
}
