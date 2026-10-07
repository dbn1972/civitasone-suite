import { notFound } from "next/navigation";
import { PageHeader, StatusPill, Card, DataTable, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate, formatEnumLabel } from "@/lib/formatters";
import { ApplyAllotmentForm } from "./ApplyAllotmentForm";
import type { QuarterRow } from "../QuartersTable";

type AllotmentSummary = {
  id: string;
  quarterId: string;
  employeeRef: string;
  employeeName: string | null;
  quarterNo: string | null;
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

// GAP-ESTAB-QUARTERS-DETAIL-01: request allotments filtered by quarterId
// (the service now supports ?quarterId=<id>) instead of the whole estate list.
async function getAllotmentsForQuarter(quarterId: string): Promise<LoaderResult<{ rows: AllotmentSummary[]; total: number }>> {
  return fetchJson<unknown, { rows: AllotmentSummary[]; total: number }>(
    `/api/v1/estab/quarter-allotments?quarterId=${encodeURIComponent(quarterId)}&limit=50`,
    { rows: [], total: 0 },
    {
      telemetryKey: "estab.quarters.allotments.byQuarter",
      mapResponse: (p) => {
        const obj = p as { data?: AllotmentSummary[]; total?: number };
        const arr = Array.isArray(obj?.data) ? obj.data : Array.isArray(p) ? (p as AllotmentSummary[]) : null;
        if (!arr) return null;
        return { rows: arr, total: typeof obj?.total === "number" ? obj.total : arr.length };
      },
    },
  );
}

export default async function QuarterDetailPage({ params }: { params: { id: string } }) {
  const { data: quarter, source: quarterSource } = await getQuarter(params.id);

  if (!quarter) {
    // GAP-ESTAB-QUARTERS-DETAIL-03: distinguish 404 from server error.
    if (quarterSource === "error") {
      return (
        <div className="page-main wrap" aria-labelledby="page-heading">
          <PageHeader title="Quarter" back="/estab/quarters" />
          <RefreshErrorState error={toHumanError("load", { area: "quarter" })} backHref="/estab/quarters" />
        </div>
      );
    }
    notFound();
  }

  const { data: allotmentResult, source: allotmentSource } = await getAllotmentsForQuarter(quarter.id);
  const quarterAllotments = allotmentResult.rows;
  const allotmentTotal = allotmentResult.total;
  const errored = allotmentSource === "error";

  const allotmentRows = quarterAllotments.map((a) => {
    const employeeShort = `${a.employeeRef.slice(0, 8)}…`;
    return {
      id: a.id,
      employeeRef: a.employeeRef,
      employeeDisplay: a.employeeName ?? employeeShort,
      designation: a.designation ?? "—",
      payLevel: a.payLevel ?? "—",
      status: a.status,
      appliedAt: formatIndianDate(a.appliedAt),
    };
  });

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={quarter.quarterNo}
        subtitle={`${quarter.quarterType.replace(/_/g, " ").toUpperCase()} · ${quarter.category}${quarter.locality ? ` · ${quarter.locality}` : ""}`}
        back="/estab/quarters"
        actions={<StatusPill status={quarter.status} />}
      />

      <Card title="Quarter details" padding>
        <dl style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", margin: 0 }}>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Address</dt><dd style={{ margin: 0 }}>{quarter.address ?? "—"}</dd></div>
          {/* GAP-ESTAB-QUARTERS-DETAIL-05: format carpet area with Indian grouping */}
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Carpet area</dt><dd style={{ margin: 0 }}>{quarter.carpetAreaSqft ? `${Number(quarter.carpetAreaSqft).toLocaleString("en-IN")} sq. ft.` : "—"}</dd></div>
          {/* GAP-ESTAB-QUARTERS-DETAIL-04: humanise condition; version removed */}
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Condition</dt><dd style={{ margin: 0 }}>{formatEnumLabel(quarter.condition)}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Org unit</dt><dd style={{ margin: 0 }}>{quarter.orgUnit ?? "—"}</dd></div>
        </dl>
      </Card>

      {/* GAP-ESTAB-QUARTERS-DETAIL-05: explain why the form is absent for non-vacant quarters */}
      {quarter.status === "vacant" ? (
        <ApplyAllotmentForm quarterId={quarter.id} />
      ) : (
        <Card padding>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }} role="note">
            Applications are only accepted for vacant quarters. This quarter is{" "}
            <strong>{formatEnumLabel(quarter.status)}</strong>. See the allotment history below for current occupancy.
          </p>
        </Card>
      )}

      <Card title="Allotment history for this quarter">
        {errored && quarterAllotments.length === 0 ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "allotment history" })} />
          </div>
        ) : (
          <>
            {/* GAP-ESTAB-QUARTERS-DETAIL-01: show truncation notice */}
            {allotmentTotal > quarterAllotments.length && (
              <p style={{ margin: "0 16px 8px", fontSize: 13, color: "var(--ink2)" }}>
                Showing {quarterAllotments.length} of {allotmentTotal} allotments.
              </p>
            )}
            <DataTable
              columns={[
                { key: "employeeDisplay" as const, label: "Employee" },
                { key: "designation" as const, label: "Designation" },
                { key: "payLevel" as const, label: "Pay Level" },
                { key: "status" as const, label: "Status", cellType: "status" as const },
                { key: "appliedAt" as const, label: "Applied" },
              ]}
              rows={allotmentRows}
              rowLinkKey="id"
              rowLinkPrefix="/estab/quarters/allotments/"
              identifyingColumnKey="employeeDisplay"
              pageSize={10}
              emptyIcon="📋"
              emptyTitle="No allotment applications yet"
              emptyMessage="Applications for this quarter will appear here."
            />
          </>
        )}
      </Card>
    </div>
  );
}
