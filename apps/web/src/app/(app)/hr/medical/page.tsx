import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

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
  amount: string;
  approvedAmount: string;
  claimantType: string;
  filedDate: string;
  status: string;
} & Record<string, unknown>;

function formatINR(minor?: string): string {
  if (!minor) return "—";
  const n = Number(minor);
  if (isNaN(n)) return "—";
  return "₹" + (n / 100).toLocaleString("en-IN", { minimumFractionDigits: 0 });
}

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/medical/claims", [], {
    telemetryKey: "hr.medical",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiRow[] })?.data;
      if (!Array.isArray(arr)) return null;
      return (arr as ApiRow[]).map((r) => ({
        id: r.id,
        caseRef: "MED/" + r.id.slice(0, 8).toUpperCase(),
        claimType: r.claim_type ?? "—",
        hospital: r.hospital_name ?? "—",
        amount: formatINR(r.amount_minor),
        approvedAmount: r.approved_amount_minor ? formatINR(r.approved_amount_minor) : "—",
        claimantType: r.dependant_name ? `Dependant (${r.dependant_relation ?? ""})` : "Self",
        filedDate: r.created_at ? r.created_at.slice(0, 10) : "—",
        status: r.status,
      }));
    },
  });
}

export default async function MedicalPage() {
  const { data: items, source } = await getData();

  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved" || i.status === "paid").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "caseRef", label: "Claim Ref" },
    { key: "claimType", label: "Claim Type" },
    { key: "hospital", label: "Hospital" },
    { key: "amount", label: "Claimed Amount" },
    { key: "approvedAmount", label: "Approved" },
    { key: "claimantType", label: "Claimant" },
    { key: "filedDate", label: "Filed Date" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Medical Claims"
        subtitle="CGHS / CS(MA) medical reimbursement claims — tracking and approval status."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏥" iconBg="#e6f0ff" label="Total Claims" value={items.length} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved / Paid" value={approved} />
        <StatCard icon="🔴" iconBg="#fff1f0" label="Rejected" value={rejected} />
      </StatGrid>
      <Card title="Medical Reimbursement Claims">
        <DataTable<Row>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by claim type, hospital or status…"
          pageSize={15}
          emptyIcon="🏥"
          emptyTitle="No medical claims filed"
          emptyMessage="Medical reimbursement claims filed by employees under CGHS or CS(MA) Rules appear here. Both self and dependent claims are tracked."
        />
      </Card>
    </main>
  );
}
