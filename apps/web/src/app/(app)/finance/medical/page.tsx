import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { MedicalClaimForm } from "./MedicalClaimForm";

/**
 * MedicalPage — CGHS / CS(MA) Rules 1944 reimbursement claims.
 * Shows indoor/outdoor claims with referral status and CGHS ward entitlement.
 */

type ApiMedicalClaim = {
  id: string;
  employee?: { name?: string; employeeNo?: string };
  treatmentDate: string;
  hospital: string;
  diagnosis: string;
  claimType: "Indoor" | "Outdoor";
  amountMinor: number;
  cghsWard?: string;
  referralStatus?: string;
  status: string;
  created_at?: string;
};

type Row = {
  id: string;
  employee: string;
  treatmentDate: string;
  hospital: string;
  diagnosis: string;
  claimType: string;
  amount: string;
  cghsWard: string;
  referralStatus: string;
  status: string;
} & Record<string, unknown>;

function formatINR(minor: number | undefined): string {
  if (minor == null) return "—";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

function mapRows(rows: ApiMedicalClaim[]): Row[] {
  return rows.map((c) => ({
    id: c.id,
    employee: c.employee?.name
      ? `${c.employee.name} (${c.employee.employeeNo ?? "—"})`
      : "—",
    treatmentDate: c.treatmentDate,
    hospital: c.hospital,
    diagnosis: c.diagnosis,
    claimType: c.claimType ?? "Outdoor",
    amount: formatINR(c.amountMinor),
    cghsWard: c.cghsWard ?? "General",
    referralStatus: c.referralStatus ?? "Not Required",
    status: c.status ?? "Pending",
  }));
}

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/finance/medical-claims", [], {
    telemetryKey: "finance.medical",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiMedicalClaim[] })?.data;
      return Array.isArray(arr) ? mapRows(arr as ApiMedicalClaim[]) : null;
    },
  });
}

const COLUMNS: {
  key: keyof Row & string;
  label: string;
  cellType?: "status";
}[] = [
  { key: "employee", label: "Employee" },
  { key: "treatmentDate", label: "Treatment Date" },
  { key: "hospital", label: "Hospital" },
  { key: "diagnosis", label: "Diagnosis" },
  { key: "claimType", label: "Type" },
  { key: "cghsWard", label: "CGHS Ward" },
  { key: "referralStatus", label: "Referral" },
  { key: "amount", label: "Amount" },
  { key: "status", label: "Status", cellType: "status" },
];

export default async function MedicalPage() {
  const { data: items, source } = await getData();

  const pending = items.filter((i) => i.status === "Pending").length;
  const approved = items.filter((i) => i.status === "Approved").length;
  const indoor = items.filter((i) => i.claimType === "Indoor").length;
  const totalMinor = items.reduce((s, i) => {
    const num = parseFloat(String(i.amount).replace(/[₹,]/g, "")) || 0;
    return s + num;
  }, 0);

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Medical Reimbursement"
        subtitle="CGHS / CS(MA) Rules 1944 — indoor and outdoor reimbursement claims with referral and ward entitlement tracking."
        back="/finance"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🏥" iconBg="#fef3f2" label="Total Claims" value={items.length} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="🛏️" iconBg="#f0f4ff" label="Indoor" value={indoor} />
      </StatGrid>

      <MedicalClaimForm />

      <Card title="Medical Claims Register">
        {items.length === 0 ? (
          <EmptyState
            icon="🏥"
            title="No medical claims"
            message="Medical reimbursement claims under CGHS / CS(MA) Rules appear here. Use the form above to submit a new claim."
          />
        ) : (
          <DataTable<Row>
            columns={COLUMNS}
            rows={items}
            sortable
            filterable
            filterPlaceholder="Filter by employee, hospital or status…"
            pageSize={20}
            emptyIcon="🏥"
            emptyTitle="No matching claims"
            emptyMessage="Adjust the filter to find the medical claim."
          />
        )}
      </Card>
    </div>
  );
}
