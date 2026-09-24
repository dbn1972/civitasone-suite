import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";

type ApiRow = {
  id: string;
  employee_id: string;
  claim_type: string;
  amount_minor: string;
  hospital_name?: string;
  diagnosis?: string;
  status: string;
  dependant_name?: string;
  dependant_relation?: string;
  approved_amount_minor?: string;
  created_at: string;
} & Record<string, unknown>;

type Row = {
  id: string;
  caseRef: string;
  claimType: string;
  hospital: string;
  amount: number | null;
  approvedAmount: number | null;
  claimantType: string;
  filedDate: string;
  status: string;
} & Record<string, unknown>;

async function getData(t: Awaited<ReturnType<typeof getTranslations>>): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/medical/claims", [], {
    telemetryKey: "hr.medical",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiRow[] })?.data;
      if (!Array.isArray(arr)) return null;
      return (arr as ApiRow[]).map((r) => {
        const amountNum = r.amount_minor != null ? Number(r.amount_minor) : null;
        const approvedNum = r.approved_amount_minor != null ? Number(r.approved_amount_minor) : null;
        return {
          id: r.id,
          caseRef: "MED/" + r.id.slice(0, 8).toUpperCase(),
          claimType: r.claim_type ?? "—",
          hospital: r.hospital_name ?? "—",
          amount: amountNum != null && Number.isFinite(amountNum) ? amountNum : null,
          approvedAmount: approvedNum != null && Number.isFinite(approvedNum) ? approvedNum : null,
          claimantType: r.dependant_name ? t("claimantDependant", { relation: r.dependant_relation ?? "" }) : t("claimantSelf"),
          filedDate: formatIndianDate(r.created_at ? r.created_at.slice(0, 10) : null),
          status: r.status,
        };
      });
    },
  });
}

export default async function MedicalPage() {
  const t = await getTranslations("medicalClaims");
  const { data: items, source } = await getData(t);
  const errored = source === "error";

  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved" || i.status === "paid").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "amount"; sortable?: boolean }[] = [
    { key: "caseRef", label: t("colClaimRef") },
    { key: "claimType", label: t("colClaimType") },
    { key: "hospital", label: t("colHospital") },
    { key: "amount", label: t("colClaimedAmount"), cellType: "amount" },
    { key: "approvedAmount", label: t("colApproved"), cellType: "amount" },
    { key: "claimantType", label: t("colClaimant") },
    { key: "filedDate", label: t("colFiledDate"), sortable: false },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel={t("backToHr")}
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏥" iconBg="var(--infobg, #e6f0ff)" label={t("statTotalLabel")} value={errored ? null : items.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg, #fffbe6)" label={t("statPendingLabel")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg, #e6f7f0)" label={t("statApprovedLabel")} value={errored ? null : approved} />
        <StatCard icon="🔴" iconBg="var(--badbg, #fff1f0)" label={t("statRejectedLabel")} value={errored ? null : rejected} />
      </StatGrid>
      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "medical claims" })} backHref="/hr" />
          </div>
        ) : (
          <DataTable<Row>
            columns={columns}
            rows={items}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="🏥"
            emptyTitle={t("emptyTitle")}
            emptyMessage={t("emptyMessage")}
          />
        )}
      </Card>
    </div>
  );
}
