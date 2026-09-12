import { PageHeader, StatGrid, StatCard, Card, DataTable, Tabs } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PromotionBatchView } from "./_components/PromotionBatchView";
import { SeniorityListActions } from "./_components/SeniorityListActions";
import type { PromotionRow } from "../promotion/_components/PromotionCard";

// DOM-023: mirrors the backend's HR_ROLES guard exactly
// (services/hrms-service/src/modules/seniority/routes.ts) for the
// generate/approve write actions -- the broader read-only "manager" role
// that can see the live GET views above is intentionally excluded.
const SENIORITY_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

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

async function getBatchPromotions(): Promise<PromotionRow[]> {
  const r = await fetchJson<unknown, PromotionRow[]>("/api/v1/hrms/lifecycle/promotions", [], {
    telemetryKey: "hr.dpc.promotions",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: PromotionRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function DpcPage() {
  const roles = getSessionRoles();
  const canAdministerSeniority = roles.some((r) => SENIORITY_ADMIN_ROLES.includes(r));

  const [{ data, source }, batchPromotions] = await Promise.all([getData(), getBatchPromotions()]);
  const { asOf, eligibleCount, ineligibleCount, eligible, ineligible } = data ?? {
    asOf: "—", eligibleCount: 0, ineligibleCount: 0, eligible: [], ineligible: [],
  };
  const totalOfficers = (eligibleCount ?? 0) + (ineligibleCount ?? 0);

  const eligibleCols: { key: keyof EligibleRow & string; label: string; align?: "left" | "right" }[] = [
    { key: "eligibilityRank",  label: "Rank",              align: "right" },
    { key: "fullName",         label: "Officer Name"                        },
    { key: "department",       label: "Department"                          },
    { key: "designation",      label: "Designation"                         },
    { key: "grade",            label: "Pay Grade"                           },
    { key: "qualifyingYears",  label: "Qualifying Service",align: "right" },
    { key: "dateOfJoining",    label: "Date of Joining"                     },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="DPC — Departmental Promotion Committee"
        subtitle={`Seniority list as of ${asOf}. Minimum qualifying service: 5 years.`}
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      <SeniorityListActions canAdminister={canAdministerSeniority} />

      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Eligible Officers"  value={eligibleCount} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Not Yet Eligible"   value={ineligibleCount} />
        <StatCard icon="📅" iconBg="#f5f5f5" label="As On Date"         value={asOf} />
        <StatCard icon="👥" iconBg="#e6f7f0" label="Total Officers"     value={totalOfficers} />
      </StatGrid>

      {/* Eligible Officers seniority list */}
      <Card title="Eligible Officers — Seniority List">
        <DataTable<EligibleRow>
          columns={eligibleCols}
          rows={eligible}
          sortable filterable
          filterPlaceholder="Filter by name, department or grade…"
          pageSize={20}
          emptyIcon="📋"
          emptyTitle="No eligible officers"
          emptyMessage="Officers who complete the minimum qualifying service period appear here in seniority order for DPC consideration."
        />
      </Card>

      {/* DPC Batch Promotion View */}
      <Card title="DPC Batch Promotions">
        <div className="pad">
          <PromotionBatchView promotions={batchPromotions} />
        </div>
      </Card>

      {ineligible.length > 0 && (
        <div className="mt-4"><Card>
          <DataTable<EligibleRow>
            columns={[
              { key: "fullName",        label: "Officer Name"           },
              { key: "department",      label: "Department"             },
              { key: "grade",           label: "Pay Grade"              },
              { key: "qualifyingYears", label: "Service Years", align: "right" },
            ]}
            rows={ineligible}
            sortable pageSize={10}
            emptyIcon="⏳"
            emptyTitle="All officers are eligible"
            emptyMessage=""
          />
        </Card></div>
      )}
    </main>
  );
}
