import { notFound } from "next/navigation";
import { PageHeader, StatusPill, Card, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { toHumanError } from "@/lib/messages";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { AllotmentDetailActions } from "./AllotmentDetailActions";
import type { AllotmentRow } from "../AllotmentsTable";
import type { QuarterRow } from "../../QuartersTable";
import { getSessionRoles, hasAnyRole, getSessionUserId, ESTAB_QUARTER_ACTION_ROLES } from "@/lib/auth/roleGuard";

type LicenceFeeRate = {
  id: string;
  quarterType: string;
  payLevel: string;
  monthlyMinor: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
} & Record<string, unknown>;

// GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-02: load a single allotment by id
// (service now exposes GET /quarter-allotments/:id) instead of fetching the
// whole list and `.find()`-ing it.
async function getAllotment(id: string): Promise<LoaderResult<AllotmentRow | null>> {
  return fetchJson<unknown, AllotmentRow | null>(`/api/v1/estab/quarter-allotments/${id}`, null, {
    telemetryKey: "estab.quarters.allotments.detail",
    mapResponse: (p) => {
      const obj = (p as { data?: AllotmentRow })?.data ?? (p as AllotmentRow);
      return obj && typeof obj === "object" && "id" in obj ? (obj as AllotmentRow) : null;
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
  const { data: allotment, source: allotmentSource } = await getAllotment(params.id);

  if (!allotment) {
    // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-02: distinguish 404 from outage.
    if (allotmentSource === "error") {
      return (
        <div className="page-main wrap" aria-labelledby="page-heading">
          <PageHeader title="Allotment" back="/estab/quarters/allotments" />
          <RefreshErrorState error={toHumanError("load", { area: "allotment" })} backHref="/estab/quarters/allotments" />
        </div>
      );
    }
    notFound();
  }

  const [{ data: quarter, source: quarterSource }, { data: rates, source: ratesSource }] = await Promise.all([
    getQuarter(allotment.quarterId),
    getLicenceFeeRates(),
  ]);

  const applicableRate = allotment.payLevel && quarter
    ? rates.find((r) => r.quarterType === quarter.quarterType && r.payLevel === allotment.payLevel) ?? null
    : null;

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-03: identify the applicant by name,
  // falling back to a short ref when hrms enrichment failed.
  const employeeShort = `${allotment.employeeRef.slice(0, 8)}…`;
  const employeeDisplay = allotment.employeeName ?? employeeShort;
  const quarterLabel = allotment.quarterNo ?? (quarter ? quarter.quarterNo : `${allotment.quarterId.slice(0, 8)}…`);

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-04 (+OPERATORS-02): lifecycle actions
  // gated to estab admins; the server stays authoritative.
  const canAct = hasAnyRole(getSessionRoles(), ESTAB_QUARTER_ACTION_ROLES);
  // GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-01: pre-check maker-checker — a user
  // cannot allot their own application.
  const sessionUserId = getSessionUserId();
  const isApplicant = !!sessionUserId && sessionUserId === allotment.employeeRef;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Allotment · ${quarterLabel}`}
        subtitle={`Employee ${employeeDisplay} · Applied ${formatIndianDate(allotment.appliedAt)}`}
        back="/estab/quarters/allotments"
        actions={
          <>
            {(allotmentSource === "error" || quarterSource === "error") && <DataSourceBadge source="error" />}
            <StatusPill status={allotment.status} />
          </>
        }
      />

      <Card title="Application details" padding>
        <dl style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", margin: 0 }}>
          <div>
            <dt style={{ fontSize: 12, color: "var(--ink2)" }}>Employee</dt>
            <dd style={{ margin: 0 }}>
              {employeeDisplay}
              {!allotment.employeeName && (
                <span style={{ display: "block", fontSize: 11, color: "var(--ink2)" }}>Name unavailable</span>
              )}
            </dd>
          </div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Quarter</dt><dd style={{ margin: 0 }}>{quarterLabel}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Designation</dt><dd style={{ margin: 0 }}>{allotment.designation ?? "—"}</dd></div>
          <div><dt style={{ fontSize: 12, color: "var(--ink2)" }}>Pay level</dt><dd style={{ margin: 0 }}>{allotment.payLevel ?? "—"}</dd></div>
          {/* GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-06: explain the eligibility score */}
          <div>
            <dt style={{ fontSize: 12, color: "var(--ink2)" }}>Eligibility score</dt>
            <dd style={{ margin: 0 }}>
              {allotment.eligibilityScore}
              <span style={{ display: "block", fontSize: 11, color: "var(--ink2)" }}>Higher scores rank earlier in the waitlist (based on seniority and pay level).</span>
            </dd>
          </div>
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
        quarterNo={quarterLabel}
        employeeRef={allotment.employeeRef}
        employeeName={allotment.employeeName}
        canAct={canAct}
        isApplicant={isApplicant}
        monthlyLicenceFeeMinor={applicableRate ? applicableRate.monthlyMinor : null}
        licenceFeeSource={ratesSource}
      />
    </div>
  );
}
