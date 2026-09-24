import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";

const RTI_ROLES = ["hr_admin", "hr_officer", "super_admin"];

type Row = {
  id: string;
  referenceNo: string;
  applicantName: string;
  subject: string;
  receivedDate: string;
  dueDate: string;
  status: string;
  overdue: boolean;
  daysToDue: number;
} & Record<string, unknown>;

type RowWithSla = Row & { slaLabel: string };

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/rti/requests", [], {
    telemetryKey: "hr.rti",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function RtiPage() {
  /* ── Role gate ─────────────────────────────────────────────── */
  const roles = getSessionRoles();
  const canAccess = roles.some((r) => RTI_ROLES.includes(r));
  if (!canAccess) {
    return <PermissionDenied module="RTI requests" requiredRoles={RTI_ROLES} />;
  }

  const t = await getTranslations("rtiRequests");
  const { data: items, source } = await getData();
  const errored = source === "error";

  const pending = items.filter((i) => i.status === "filed" || i.status === "assigned").length;
  const overdue = items.filter((i) => i.overdue).length;
  const disposed = items.filter((i) => i.status === "responded" || i.status === "closed").length;

  // Per-request SLA visibility: overdue/daysToDue already come back from the
  // API (routes.ts's withSla()) but were previously only ever aggregated
  // into the page-level "Overdue" stat card -- a PIO looking at the actual
  // register had no way to tell, request by request, which ones need
  // action. slaLabel turns those two fields into one plain, sortable/
  // filterable column string (DataTable's `render` column prop is client-
  // only and this page is a Server Component, so this is computed here
  // rather than as a custom cell renderer).
  const rows: RowWithSla[] = items.map((item) => ({
    ...item,
    slaLabel:
      item.status === "closed"
        ? t("slaClosed")
        : item.overdue
          ? t("slaOverdueByDays", { days: Math.abs(item.daysToDue) })
          : t("slaDueInDays", { days: item.daysToDue }),
  }));

  const columns: { key: keyof RowWithSla & string; label: string; cellType?: "status" }[] = [
    { key: "referenceNo", label: t("colReferenceNo") },
    { key: "applicantName", label: t("colApplicant") },
    { key: "subject", label: t("colSubject") },
    { key: "receivedDate", label: t("colReceived") },
    { key: "dueDate", label: t("colDueDate") },
    { key: "slaLabel", label: t("colSla") },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<span />}
      />
      <DataSourceBadge source={source} message={t("dataSourceErrorMessage")} />
      <StatGrid>
        <StatCard icon="📂" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? null : items.length} />
        <StatCard icon="🔔" iconBg="var(--warnbg, #fffbe6)" label={t("statPendingLabel")} value={errored ? null : pending} />
        <StatCard icon="🔴" iconBg="var(--badbg, #fff1f0)" label={t("statOverdueLabel")} value={errored ? null : overdue} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statDisposedLabel")} value={errored ? null : disposed} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "rti" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<RowWithSla>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="📂"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
