import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { DeputationCard, type DeputationRow } from "./_components/DeputationCard";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

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
  const { data: items, source } = await getData();
  const errored = source === "error";

  const active    = items.filter((i) => i.status === "active").length;
  const pending   = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed").length;
  const recalled  = items.filter((i) => i.status === "recalled").length;

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
      <DataSourceBadge source={source} />

      <StatGrid>
<StatCard icon="🏛️" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")} value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statActive")}            value={errored ? null : active} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")}           value={errored ? null : pending} />
        <StatCard icon="📋" iconBg="var(--bg, #f5f5f5)" label={t("statCompleted")}         value={errored ? null : completed} />
        {recalled > 0 && (
          <StatCard icon="↩️" iconBg="var(--badbg, #fee2e2)" label={t("statRecalled")} value={errored ? null : recalled} />
        )}
      </StatGrid>

      {/* Card grid for active/pending */}
      {!errored && items.filter((i) => ["active", "pending"].includes(i.status)).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--ink2)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 14px" }}>
            {t("activeSection")}
          </h2>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
            {items.filter((i) => ["active", "pending"].includes(i.status)).map((d) => (
              <DeputationCard key={d.id} deputation={d} />
            ))}
          </div>
        </div>
      )}

      {/* Full table */}
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "deputation" })} backHref="/hr" />
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
