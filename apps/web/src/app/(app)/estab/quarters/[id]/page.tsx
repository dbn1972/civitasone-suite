import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatusPill, Card, DataTable } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { ApplyAllotmentForm } from "./ApplyAllotmentForm";
import type { QuarterRow } from "../QuartersTable";

type AllotmentSummary = {
  id: string;
  quarterId: string;
  employeeRef: string;
  designation: string | null;
  payLevel: string | null;
  status: string;
  appliedAt: string;
} & Record<string, unknown>;

async function getQuarter(id: string): Promise<LoaderResult<QuarterRow | null>> {
  return fetchJson<unknown, QuarterRow | null>(`/api/v1/estab/quarters/${id}`, null, {
    telemetryKey: "estab.quarters.detail",
    mapResponse: (p) => {
      const obj = (p as { data?: QuarterRow })?.data ?? (p as QuarterRow);
      return obj && typeof obj === "object" && "id" in obj ? (obj as QuarterRow) : null;
    },
  });
}

async function getAllotments(): Promise<LoaderResult<AllotmentSummary[]>> {
  return fetchJson<unknown, AllotmentSummary[]>("/api/v1/estab/quarter-allotments", [], {
    telemetryKey: "estab.quarters.allotments.byQuarter",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: AllotmentSummary[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function QuarterDetailPage({ params }: { params: { id: string } }) {
  const [{ data: quarter, source: quarterSource }, { data: allotments, source: allotmentSource }] =
    await Promise.all([getQuarter(params.id), getAllotments()]);

  if (!quarter) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Quarter" back="/estab/quarters" />
        {quarterSource === "error" ? (
          <DataSourceBadge source="error" />
        ) : (
          <p className="sub">The requested quarter could not be found.</p>
        )}
      </main>
    );
  }

  const quarterAllotments = allotments.filter((a) => a.quarterId === quarter.id);

  const allotmentRows = quarterAllotments.map((a) => ({
    id: a.id,
    employeeRef: a.employeeRef,
    designation: a.designation ?? "—",
    payLevel: a.payLevel ?? "—",
    status: a.status,
    appliedAt: formatIndianDate(a.appliedAt),
  }));

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={quarter.quarterNo}
        subtitle={`${quarter.quarterType.replace(/_/g, " ").toUpperCase()} · ${quarter.category}${quarter.locality ? ` · ${quarter.locality}` : ""}`}
        back="/estab/quarters"
        actions={
          <>
            {quarterSource === "error" && <DataSourceBadge source="error" />}
            <StatusPill status={quarter.status} />
          </>
        }
      />

      <Card title="Quarter details" padding>
        <dl style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", margin: 0 }}>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Address</dt><dd style={{ margin: 0 }}>{quarter.address ?? "—"}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Carpet area</dt><dd style={{ margin: 0 }}>{quarter.carpetAreaSqft ? `${quarter.carpetAreaSqft} sq. ft.` : "—"}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Condition</dt><dd style={{ margin: 0 }}>{quarter.condition}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Org unit</dt><dd style={{ margin: 0 }}>{quarter.orgUnit ?? "—"}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Version</dt><dd style={{ margin: 0 }}>{quarter.version}</dd></div>
        </dl>
      </Card>

      {quarter.status === "vacant" && <ApplyAllotmentForm quarterId={quarter.id} />}

      <Card title="Allotment history for this quarter">
        {allotmentSource === "error" && quarterAllotments.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : (
          <DataTable
            columns={[
              { key: "employeeRef" as const, label: "Employee", render: (r) => <span className="mono">{String(r.employeeRef).slice(0, 8)}…</span> },
              { key: "designation" as const, label: "Designation" },
              { key: "payLevel" as const, label: "Pay Level" },
              { key: "status" as const, label: "Status", cellType: "status" as const },
              { key: "appliedAt" as const, label: "Applied" },
            ]}
            rows={allotmentRows}
            rowLinkKey="id"
            rowLinkPrefix="/estab/quarters/allotments/"
            pageSize={10}
            emptyIcon="📋"
            emptyTitle="No allotment applications yet"
            emptyMessage="Applications for this quarter will appear here."
          />
        )}
      </Card>
    </main>
  );
}
