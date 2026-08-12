import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";

type EligibleRow = {
  employeeId: string;
  fullName: string;
  department?: string;
  designation?: string;
  grade?: string;
  dateOfJoining?: string;
  yearsOfService?: number;
  qualifyingYears: number;
  eligibilityRank: number;
} & Record<string, unknown>;

type DpcData = {
  asOf: string;
  minQualifyingYears: number;
  eligibleCount: number;
  ineligibleCount: number;
  eligible: EligibleRow[];
  ineligible: EligibleRow[];
};

async function getData() {
  return fetchJson<unknown, DpcData>("/api/v1/hrms/dpc/eligibility", {} as DpcData, {
    telemetryKey: "hr.dpc",
    mapResponse: (p) => {
      const d = p as DpcData;
      return d && typeof d === "object" && Array.isArray(d.eligible) ? d : null;
    },
  });
}

export default async function DpcPage() {
  const { data, source } = await getData();
  const { asOf, eligibleCount, ineligibleCount, eligible, ineligible } = data ?? {
    asOf: "—", eligibleCount: 0, ineligibleCount: 0, eligible: [], ineligible: [],
  };

  const columns: { key: keyof EligibleRow & string; label: string; align?: "left" | "right" }[] = [
    { key: "eligibilityRank", label: "Rank", align: "right" },
    { key: "fullName", label: "Officer Name" },
    { key: "department", label: "Department" },
    { key: "designation", label: "Designation" },
    { key: "grade", label: "Pay Grade" },
    { key: "qualifyingYears", label: "Qualifying Service", align: "right" },
    { key: "dateOfJoining", label: "Date of Joining" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="DPC Eligibility"
        subtitle={`Departmental Promotion Committee seniority list as of ${asOf}. Minimum qualifying service: 5 years.`}
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Eligible Officers" value={eligibleCount} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Not Yet Eligible" value={ineligibleCount} />
        <StatCard icon="📅" iconBg="#f5f5f5" label="As On Date" value={asOf} />
      </StatGrid>
      <Card title="Eligible Officers — Seniority List">
        <DataTable<EligibleRow>
          columns={columns}
          rows={eligible}
          sortable
          filterable
          filterPlaceholder="Filter by name, department or grade…"
          pageSize={20}
          emptyIcon="📋"
          emptyTitle="No eligible officers"
          emptyMessage="Officers who complete the minimum qualifying service period appear here in seniority order for DPC consideration."
        />
      </Card>
      {ineligible.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Card title="Not Yet Eligible">
            <DataTable<EligibleRow>
              columns={[
                { key: "fullName", label: "Officer Name" },
                { key: "department", label: "Department" },
                { key: "grade", label: "Pay Grade" },
                { key: "qualifyingYears", label: "Service Years", align: "right" },
              ]}
              rows={ineligible}
              sortable
              pageSize={10}
              emptyIcon="⏳"
              emptyTitle="All officers are eligible"
              emptyMessage=""
            />
          </Card>
        </div>
      )}
    </main>
  );
}
