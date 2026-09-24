import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { TransferWithApproval } from "./TransferWithApproval";
import { TransferOrderCard, type TransferRow } from "./_components/TransferOrderCard";
import { TransferListFilters } from "./_components/TransferListFilters";
import { toHumanError } from "@/lib/messages";

import { getTranslations } from "next-intl/server";

async function getData(): Promise<LoaderResult<TransferRow[]>> {
  // NOTE: this used to fall back to GET /api/v1/hrms/transfers whenever the
  // lifecycle endpoint's array came back empty -- but that fallback path
  // does not exist as a backend route at all, so it always failed. Net
  // effect: a genuinely-empty (successful, zero-transfers) result from the
  // real endpoint was silently overwritten by a guaranteed error, turning a
  // true "no transfers" empty state into a false "couldn't load" one. Call
  // the one real endpoint directly.
  return fetchJson<unknown, TransferRow[]>("/api/v1/hrms/lifecycle/transfers", [], {
    telemetryKey: "hr.transfer",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: TransferRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function TransferPage() {
  const t = await getTranslations("transfer");
  const { data: raw, source } = await getData();
  const errored = source === "error";
  // The raw backend row only carries employeeId/fromDeptId/toDeptId (no
  // joined names yet) -- degrade to the id rather than rendering a blank
  // DataTable cell, matching the fallback TransferOrderCard already uses.
  const items: TransferRow[] = raw.map((i) => ({
    ...i,
    employee: i.employee ?? i.employeeId ?? "Unknown",
    fromOffice: i.fromOffice ?? i.fromDeptId ?? "—",
    toOffice: i.toOffice ?? i.toDeptId ?? "—",
  }));

  const completed = items.filter((i) => ["completed", "joined"].includes(i.status)).length;
  const pending   = items.filter((i) => ["pending", "initiated"].includes(i.status)).length;
  const approved  = items.filter((i) => ["approved", "order_issued"].includes(i.status)).length;
  const relieved  = items.filter((i) => i.status === "relieved").length;

  const tableColumns: { key: keyof TransferRow & string; label: string; cellType?: "status" }[] = [
    { key: "employee",     label: t("colEmployee")      },
    { key: "fromOffice",   label: t("colFrom")          },
    { key: "toOffice",     label: t("colTo")            },
    { key: "effectiveDate",label: t("colEffectiveDate")},
    { key: "orderNo",      label: t("colOrderNo")     },
    { key: "relievedDate", label: t("colRelievedDate") },
    { key: "status",       label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<TransferWithApproval />}
      />
      <DataSourceBadge source={source} message="Couldn't load transfer orders — showing nothing" />

      <StatGrid>
<StatCard icon="🔄" iconBg="var(--infobg, #e6f0ff)" label={t("statTotal")}    value={errored ? null : items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statCompleted")} value={errored ? null : completed} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPending")}            value={errored ? null : pending} />
        <StatCard icon="👍" iconBg="var(--infobg, #f0f5ff)" label={t("statApproved")}       value={errored ? null : approved} />
        {relieved > 0 && (
          <StatCard icon="📍" iconBg="var(--warnbg, #fef9c3)" label={t("statRelieved")} value={errored ? null : relieved} />
        )}
      </StatGrid>

      {/* Card grid with filters + export — client island */}
      <TransferListFilters transfers={items} />

      {/* Table fallback for density view */}
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "transfer" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<TransferRow>
          columns={tableColumns}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="📍"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
