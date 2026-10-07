import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader, Card, DataTable, LoadErrorState, StatusPill } from "../../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { resolveEmployees } from "@/lib/entityAdapters/employee";
import { ContractActions } from "./ContractActions";
import { toHistoryRows, type HistoryRow } from "../contractRules";

type Contract = {
  id: string;
  employeeId: string;
  contractNo: string;
  startDate: string;
  endDate: string;
  status: string;
  renewalCount: number;
  version: number;
  terms: { role?: string } & Record<string, unknown>;
};

type ApiHistoryRow = Record<string, unknown>;

/**
 * GAP-HR-CONTRACTUAL-05: contract detail. Fed by GET /v1/hrms/contracts/:id and
 * GET /v1/hrms/contracts/employee/:employeeId/history (both ALL_ROLES in
 * contracts/routes.ts); Renew/Terminate live in ContractActions.
 */
export default async function ContractDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("contractualDetail");
  const roles = getSessionRoles();

  const result = await fetchJson<unknown, Contract | null>(`/api/v1/hrms/contracts/${params.id}`, null, {
    telemetryKey: "hr.contractual.detail",
    mapResponse: (p) => {
      const d = (p as { data?: Contract })?.data;
      return d && typeof d === "object" ? d : null;
    },
  });
  if (result.source === "error" && result.status === 404) notFound();
  const contract = result.data;
  if (result.source === "error" || !contract) {
    return (
      <div className="page-main wrap">
        <PageHeader title={t("title")} back="/hr/contractual" backLabel={t("backLabel")} />
        <LoadErrorState result={result} area="contract" backHref="/hr/contractual" />
      </div>
    );
  }

  const [history, employees] = await Promise.all([
    fetchJson<unknown, ApiHistoryRow[]>(`/api/v1/hrms/contracts/employee/${contract.employeeId}/history`, [], {
      telemetryKey: "hr.contractual.history",
      mapResponse: (p) => {
        const a = (p as { data?: ApiHistoryRow[] })?.data;
        return Array.isArray(a) ? a : null;
      },
    }),
    resolveEmployees([contract.employeeId]),
  ]);
  const employee = employees[0];

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("titleWithNo", { no: contract.contractNo })}
        subtitle={employee?.label ?? "—"}
        back="/hr/contractual"
        backLabel={t("backLabel")}
        actions={
          <ContractActions
            contractId={contract.id}
            status={contract.status}
            version={contract.version}
            currentEndDate={contract.endDate}
            roles={roles}
          />
        }
      />
      <Card title={t("detailsTitle")}>
        <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 24px", padding: 16, margin: 0 }}>
          <dt>{t("fieldStatus")}</dt><dd><StatusPill status={contract.status} /></dd>
          <dt>{t("fieldRole")}</dt><dd>{contract.terms?.role ?? "—"}</dd>
          <dt>{t("fieldStart")}</dt><dd>{formatIndianDate(contract.startDate)}</dd>
          <dt>{t("fieldEnd")}</dt><dd>{formatIndianDate(contract.endDate)}</dd>
          <dt>{t("fieldRenewals")}</dt><dd>{contract.renewalCount}</dd>
        </dl>
      </Card>
      <Card title={t("historyTitle")}>
        <DataTable<HistoryRow & Record<string, unknown>>
          columns={[
            { key: "contractNo", label: t("colContractNo") },
            { key: "startDate", label: t("fieldStart"), cellType: "date" },
            { key: "endDate", label: t("fieldEnd"), cellType: "date" },
            { key: "status", label: t("fieldStatus"), cellType: "status" },
          ]}
          rows={toHistoryRows(history.data)}
          emptyIcon="📑"
          emptyTitle={t("historyEmpty")}
          emptyMessage={t("historyEmpty")}
        />
      </Card>
    </div>
  );
}
