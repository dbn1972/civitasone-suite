import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type HeadcountRow = { group_key: string; count: number } & Record<string, unknown>;
type RetirementRow = { employeeId: string; fullName: string; department?: string; dateOfBirth?: string; dateOfRetirement?: string; monthsLeft?: number } & Record<string, unknown>;

async function getHeadcount(): Promise<LoaderResult<HeadcountRow[]>> {
  return fetchJson<unknown, HeadcountRow[]>("/api/v1/hrms/workforce/headcount?groupBy=department", [], {
    telemetryKey: "hr.workforce.headcount",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: HeadcountRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getRetirements(): Promise<LoaderResult<RetirementRow[]>> {
  return fetchJson<unknown, RetirementRow[]>("/api/v1/hrms/workforce/retirement-forecast", [], {
    telemetryKey: "hr.workforce.retirement",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RetirementRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function WorkforcePage() {
  const t = await getTranslations("workforce");
  const [hc, rt] = await Promise.all([getHeadcount(), getRetirements()]);
  const headcount = hc.data;
  const retirements = rt.data;
  const source = hc.source === "error" || rt.source === "error" ? "error" : hc.source;
  // UX-013: `source` was already computed (merged across both loader calls)
  // but only wired to the badge below -- never to the stat values, so a
  // failed load rendered raw zeroes (both loaders default to `[]`, and
  // reduce/filter over an empty array is 0). Gate every stat on it, same
  // convention as projects/dashboard and estab/dashboard.
  const errored = source === "error";

  const totalHeadcount = headcount.reduce((s, r) => s + Number(r.count), 0);
  const retiringSoon = retirements.filter((r) => Number(r.monthsLeft ?? 99) <= 6).length;
  const retiring12 = retirements.filter((r) => Number(r.monthsLeft ?? 99) <= 12).length;

  const hcCols: { key: keyof HeadcountRow & string; label: string; align?: "left" | "right" }[] = [
    { key: "group_key", label: t("colDepartment") },
    { key: "count", label: t("colHeadcount"), align: "right" },
  ];

  const rtCols: { key: keyof RetirementRow & string; label: string; align?: "left" | "right" }[] = [
    { key: "fullName", label: t("colOfficerName") },
    { key: "department", label: t("colDepartment") },
    { key: "dateOfRetirement", label: t("colRetirementDate") },
    { key: "monthsLeft", label: t("colMonthsLeft"), align: "right" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr" backLabel="Back to HR"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="👥" iconBg="#e6f0ff" label={t("statTotalHeadcount")} value={errored ? "—" : totalHeadcount} />
        <StatCard icon="🏢" iconBg="#f5f5f5" label={t("statDepartments")} value={errored ? "—" : headcount.length} />
        <StatCard icon="⏳" iconBg="#fff1f0" label={t("statRetiringSoon")} value={errored ? "—" : retiringSoon} />
        <StatCard icon="📅" iconBg="#fffbe6" label={t("statRetiring12")} value={errored ? "—" : retiring12} />
      </StatGrid>
      <Card title={t("cardHeadcountByDept")}>
        <DataTable<HeadcountRow>
          columns={hcCols}
          rows={headcount}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholderDept")}
          pageSize={15}
          emptyIcon="👥"
          emptyTitle={t("emptyHeadcountTitle")}
          emptyMessage={t("emptyHeadcountMessage")}
        />
      </Card>
      <div style={{ marginTop: 16 }}>
        <Card title={t("cardUpcomingRetirements")}>
          <DataTable<RetirementRow>
            columns={rtCols}
            rows={retirements}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholderName")}
            pageSize={10}
            emptyIcon="📅"
            emptyTitle={t("emptyRetirementsTitle")}
            emptyMessage={t("emptyRetirementsMessage")}
          />
        </Card>
      </div>
    </main>
  );
}
