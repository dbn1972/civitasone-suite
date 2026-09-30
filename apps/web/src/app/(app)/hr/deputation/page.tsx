import { PageHeader, StatGrid, StatCard, Card, DataTable, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { DeputationCard, type DeputationRow } from "./_components/DeputationCard";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";

/** Mirrors deputation/routes.ts's own HR_ROLES for repatriate/cancel. */
const DEPUTATION_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

async function getData(): Promise<LoaderResult<DeputationRow[]>> {
  return fetchJson<unknown, DeputationRow[]>("/api/v1/hrms/deputation", [], {
    telemetryKey: "hr.deputation",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: DeputationRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function DeputationPage() {
  const t = await getTranslations("deputation");
  const result = await getData();
  const { data: items, source } = result;
  const errored = source === "error";
  const roles = getSessionRoles();
  const canManage = roles.some((r: string) => DEPUTATION_ADMIN_ROLES.includes(r));

  // GAP-HR-DEPUTATION-01: backend statuses are active|repatriated|cancelled
  // (deputation/schema.ts) -- this page used to count "completed"/"recalled"
  // (never written by the backend, always 0) and a "pending" bucket the
  // backend never writes either.
  const active = items.filter((i) => i.status === "active").length;
  const repatriated = items.filter((i) => i.status === "repatriated").length;
  const cancelled = items.filter((i) => i.status === "cancelled").length;

  const tableColumns: { key: keyof DeputationRow & string; label: string; cellType?: "status" }[] = [
    { key: "employee",     label: t("colEmployee")      },
    { key: "parentOrg",   label: t("colParentOrg")    },
    { key: "deputationOrg", label: t("colDeputedTo")  },
    { key: "fromDate",    label: t("colFrom")           },
    { key: "toDate",      label: t("colTo")             },
    { key: "period",      label: t("colPeriod")         },
    { key: "status",      label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
      />

      <StatGrid>
        <StatCard icon="🏛️" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statActive")}            value={errored ? null : active} />
        <StatCard icon="↩️" iconBg="var(--bg, #f5f5f5)" label={t("statRepatriated")}         value={errored ? null : repatriated} />
        {cancelled > 0 && (
          <StatCard icon="✕" iconBg="var(--badbg, #fee2e2)" label={t("statCancelled")} value={errored ? null : cancelled} />
        )}
      </StatGrid>

      {/* Card grid: active deputations only -- "pending" never exists on the
          backend's status enum (GAP-HR-DEPUTATION-01), so filtering it in
          here alongside "active" only ever added dead rows. */}
      {!errored && items.filter((i) => i.status === "active").length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--ink2)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 14px" }}>
            {t("activeSection")}
          </h2>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
            {items.filter((i) => i.status === "active").map((d) => (
              <DeputationCard key={d.id} deputation={d} canManage={canManage} />
            ))}
          </div>
        </div>
      )}

      {/* Full table */}
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState result={result} area="deputation" backHref="/hr" requiredRoles={["hr_admin", "hr_officer", "super_admin"]} />
          </div>
        ) : (
          <DataTable<DeputationRow>
            columns={tableColumns}
            rows={items}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="🏛️"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </div>
  );
}
