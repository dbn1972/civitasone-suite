import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { AllotmentsTable, type AllotmentRow } from "./AllotmentsTable";

async function getAllotments(): Promise<LoaderResult<{ rows: AllotmentRow[]; total: number }>> {
  return fetchJson<unknown, { rows: AllotmentRow[]; total: number }>("/api/v1/estab/quarter-allotments", { rows: [], total: 0 }, {
    telemetryKey: "estab.quarters.allotments.list",
    mapResponse: (p) => {
      const obj = p as { data?: AllotmentRow[]; total?: number };
      const arr = Array.isArray(obj?.data) ? obj.data : Array.isArray(p) ? (p as AllotmentRow[]) : null;
      if (!arr) return null;
      return { rows: arr, total: typeof obj?.total === "number" ? obj.total : arr.length };
    },
  });
}

export default async function QuarterAllotmentsPage() {
  const { data: result, source } = await getAllotments();
  const allotments = result.rows;
  const total = result.total;
  const errored = source === "error";

  const applied = allotments.filter((a) => a.status === "applied" || a.status === "waitlisted").length;
  const allotted = allotments.filter((a) => a.status === "allotted").length;
  const occupied = allotments.filter((a) => a.status === "occupied").length;
  const vacating = allotments.filter((a) => a.status === "vacation_notice").length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Quarter Allotments"
        subtitle="Applications, maker-checker allotment decisions, and the occupy / vacation-notice / vacate lifecycle."
        back="/estab/quarters"
      />

      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "quarter allotments" })} backHref="/estab/quarters" />
      ) : (
        <>
          <StatGrid>
            <StatCard icon="📝" tone="warn" label="Applied / Waitlisted" value={applied.toLocaleString("en-IN")} />
            <StatCard icon="✅" tone="good" label="Allotted" value={allotted.toLocaleString("en-IN")} />
            <StatCard icon="🏠" tone="info" label="Occupied" value={occupied.toLocaleString("en-IN")} />
            <StatCard icon="🚚" tone="bad" label="Under Vacation Notice" value={vacating.toLocaleString("en-IN")} />
          </StatGrid>

          <Card title="Allotments">
            {/* GAP-ESTAB-QUARTERS-ALLOTMENTS-01: truncation notice */}
            {total > allotments.length && (
              <p style={{ margin: "0 16px 8px", fontSize: 13, color: "var(--ink2)" }}>
                Showing {allotments.length.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")} allotments.
              </p>
            )}
            <AllotmentsTable allotments={allotments} />
          </Card>
        </>
      )}
    </div>
  );
}
