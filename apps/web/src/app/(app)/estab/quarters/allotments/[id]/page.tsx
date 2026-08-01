import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatusPill, Card } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { AllotmentDetailActions } from "./AllotmentDetailActions";
import type { AllotmentRow } from "../AllotmentsTable";
import type { QuarterRow } from "../../QuartersTable";

type LicenceFeeRate = {
  id: string;
  quarterType: string;
  payLevel: string;
  monthlyMinor: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
} & Record<string, unknown>;

async function getAllotments(): Promise<LoaderResult<AllotmentRow[]>> {
  return fetchJson<unknown, AllotmentRow[]>("/api/v1/estab/quarter-allotments", [], {
    telemetryKey: "estab.quarters.allotments.detail",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: AllotmentRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

async function getQuarter(id: string): Promise<LoaderResult<QuarterRow | null>> {
  return fetchJson<unknown, QuarterRow | null>(`/api/v1/estab/quarters/${id}`, null, {
    telemetryKey: "estab.quarters.detail.forAllotment",
    mapResponse: (p) => {
      const obj = (p as { data?: QuarterRow })?.data ?? (p as QuarterRow);
      return obj && typeof obj === "object" && "id" in obj ? (obj as QuarterRow) : null;
    },
  });
}

async function getLicenceFeeRates(): Promise<LoaderResult<LicenceFeeRate[]>> {
  return fetchJson<unknown, LicenceFeeRate[]>("/api/v1/estab/quarter-licence-fees", [], {
    telemetryKey: "estab.quarters.licenceFees",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: LicenceFeeRate[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function AllotmentDetailPage({ params }: { params: { id: string } }) {
  const { data: allotments, source: allotmentsSource } = await getAllotments();
  const allotment = allotments.find((a) => a.id === params.id) ?? null;

  if (!allotment) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Allotment" back="/estab/quarters/allotments" />
        {allotmentsSource === "error" ? (
          <DataSourceBadge source="error" />
        ) : (
          <p className="sub">The requested allotment could not be found.</p>
        )}
      </main>
    );
  }

  const [{ data: quarter, source: quarterSource }, { data: rates, source: ratesSource }] = await Promise.all([
    getQuarter(allotment.quarterId),
    getLicenceFeeRates(),
  ]);

  const applicableRate = allotment.payLevel && quarter
    ? rates.find((r) => r.quarterType === quarter.quarterType && r.payLevel === allotment.payLevel) ?? null
    : null;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Allotment · ${quarter?.quarterNo ?? allotment.quarterId.slice(0, 8) + "…"}`}
        subtitle={`Employee ${allotment.employeeRef.slice(0, 8)}… · Applied ${formatIndianDate(allotment.appliedAt)}`}
        back="/estab/quarters/allotments"
        actions={
          <>
            {(allotmentsSource === "error" || quarterSource === "error") && <DataSourceBadge source="error" />}
            <StatusPill status={allotment.status} />
          </>
        }
      />

      <Card title="Application details" padding>
        <dl style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", margin: 0 }}>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Employee</dt><dd style={{ margin: 0 }} className="mono">{allotment.employeeRef}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Quarter</dt><dd style={{ margin: 0 }}>{quarter ? quarter.quarterNo : allotment.quarterId}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Designation</dt><dd style={{ margin: 0 }}>{allotment.designation ?? "—"}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Pay level</dt><dd style={{ margin: 0 }}>{allotment.payLevel ?? "—"}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Eligibility score</dt><dd style={{ margin: 0 }}>{allotment.eligibilityScore}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Version</dt><dd style={{ margin: 0 }}>{allotment.version}</dd></div>
          <div>
            <dt style={{ fontSize: 12, color: "var(--ink2)" }}>Monthly licence fee</dt>
            <dd style={{ margin: 0 }}>
              {ratesSource === "error" ? (
                <DataSourceBadge source="error" />
              ) : applicableRate ? (
                formatMoney(applicableRate.monthlyMinor)
              ) : (
                "No rate configured for this quarter type / pay level"
              )}
            </dd>
          </div>
        </dl>
      </Card>

      <AllotmentDetailActions
        allotmentId={allotment.id}
        status={allotment.status}
        version={allotment.version}
        quarterNo={quarter ? quarter.quarterNo : allotment.quarterId.slice(0, 8) + "…"}
        employeeRef={allotment.employeeRef}
        monthlyLicenceFeeMinor={applicableRate ? applicableRate.monthlyMinor : null}
        licenceFeeSource={ratesSource}
      />
    </main>
  );
}
