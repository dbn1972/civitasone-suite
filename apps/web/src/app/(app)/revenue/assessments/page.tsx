import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { AssessmentsTable, type AssessmentRow } from "./AssessmentsTable";
import { AssessmentCreateForm } from "./AssessmentCreateForm";
import type { AssesseeOption } from "../_components/AssesseeSelect";
import type { RateHeadOption } from "../_components/RateHeadSelect";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function arrayFromPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: unknown[] }).data;
  }
  return null;
}

async function getAssessments(): Promise<LoaderResult<AssessmentRow[]>> {
  return fetchJson<unknown, AssessmentRow[]>("/api/v1/revenue/assessments", [], {
    telemetryKey: "revenue.assessments.list",
    mapResponse: (p) => {
      const arr = arrayFromPayload(p);
      if (!arr) return null;
      // GAP-REVENUE-ASSESSMENTS-01: carry remissionStatus/remissionRequestedBy
      // (defaulted on the server) so the table can gate the decide actions.
      return arr.map((raw) => {
        const r = isRecord(raw) ? raw : {};
        return {
          ...(r as object),
          remissionStatus:
            r.remissionStatus === "pending" || r.remissionStatus === "approved" || r.remissionStatus === "rejected"
              ? r.remissionStatus
              : "none",
          remissionRequestedBy: typeof r.remissionRequestedBy === "string" ? r.remissionRequestedBy : null,
        } as AssessmentRow;
      });
    },
  });
}

function mapAssessees(payload: unknown): AssesseeOption[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: AssesseeOption[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    if (typeof raw.id !== "string" || typeof raw.ownerName !== "string") continue;
    mapped.push({
      id: raw.id,
      ownerName: raw.ownerName,
      identifierNo: typeof raw.identifierNo === "string" ? raw.identifierNo : "—",
      assesseeType: typeof raw.assesseeType === "string" ? raw.assesseeType : "—",
    });
  }
  return mapped;
}

function mapRateHeads(payload: unknown): RateHeadOption[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: RateHeadOption[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    if (typeof raw.id !== "string") continue;
    mapped.push({
      id: raw.id,
      code: typeof raw.code === "string" ? raw.code : "—",
      name: typeof raw.name === "string" ? raw.name : "—",
    });
  }
  return mapped;
}

async function getAssessees(): Promise<LoaderResult<AssesseeOption[]>> {
  return fetchJson<unknown, AssesseeOption[]>("/api/v1/revenue/assessees?limit=200", [], {
    telemetryKey: "revenue.assessments.assessees",
    mapResponse: mapAssessees,
  });
}

async function getRateHeads(): Promise<LoaderResult<RateHeadOption[]>> {
  return fetchJson<unknown, RateHeadOption[]>("/api/v1/revenue/rate-heads", [], {
    telemetryKey: "revenue.assessments.rateHeads",
    mapResponse: mapRateHeads,
  });
}

export default async function AssessmentsPage() {
  const [{ data: assessmentsRaw, source }, { data: assessees }, { data: rateHeads }] = await Promise.all([
    getAssessments(),
    getAssessees(),
    getRateHeads(),
  ]);
  const currentUserId = getSessionUserId();

  // GAP-REVENUE-ASSESSMENTS-04: a failed fetch defaults to [], which would show
  // a false "0" on every stat and an "empty" table. Treat error as unknown.
  const isError = source === "error";

  // GAP-REVENUE-ASSESSMENTS-02: id -> name maps so a row shows the taxpayer's
  // name + identifier and the rate head name, not a raw UUID slice.
  const assesseeNameById: Record<string, string> = {};
  for (const a of assessees) assesseeNameById[a.id] = `${a.ownerName} — ${a.identifierNo}`;
  const rateHeadNameById: Record<string, string> = {};
  for (const h of rateHeads) rateHeadNameById[h.id] = `${h.name} (${h.code})`;

  const assessments: AssessmentRow[] = assessmentsRaw.map((a) => ({
    ...a,
    assesseeName: assesseeNameById[a.assesseeId],
    rateHeadName: rateHeadNameById[a.rateHeadId],
  }));

  const activeCount = assessments.filter((a) => a.status === "active").length;
  const revisedCount = assessments.filter((a) => a.status === "revised").length;
  const closedCount = assessments.filter((a) => a.status === "closed").length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Assessments"
        subtitle="Raise, revise, and remit municipal tax assessments against registered assessees."
        back="/revenue"
        actions={isError ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="📊" iconBg="#eff6ff" label="Total Assessments" value={isError ? null : assessments.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={isError ? null : activeCount} />
        <StatCard icon="✏️" iconBg="#fffaeb" label="Revised" value={isError ? null : revisedCount} />
        <StatCard icon="🔒" iconBg="#eef2ff" label="Closed" value={isError ? null : closedCount} />
      </StatGrid>

      <AssessmentCreateForm assessees={assessees} rateHeads={rateHeads} />

      <Card title="Assessments">
        {isError ? (
          <RefreshErrorState error={toHumanError("load", { area: "assessments" })} backHref="/revenue" />
        ) : (
          <AssessmentsTable assessments={assessments} currentUserId={currentUserId} />
        )}
      </Card>
    </div>
  );
}
