import { PageHeader, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { AdjustmentCreateForm } from "./AdjustmentCreateForm";

export type AssesseeOption = {
  id: string;
  ownerName: string;
  identifierNo: string;
  assesseeType: string;
};

export type DemandOption = {
  id: string;
  financialYear: string;
  netMinor: string;
  status: string;
};

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

function mapAssessees(payload: unknown): AssesseeOption[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: AssesseeOption[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    const ownerName = raw.ownerName;
    if (typeof id !== "string" || typeof ownerName !== "string") continue;
    mapped.push({
      id,
      ownerName,
      identifierNo: typeof raw.identifierNo === "string" ? raw.identifierNo : "—",
      assesseeType: typeof raw.assesseeType === "string" ? raw.assesseeType : "—",
    });
  }
  return mapped;
}

function mapDemands(payload: unknown): DemandOption[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: DemandOption[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    if (typeof id !== "string") continue;
    mapped.push({
      id,
      financialYear: typeof raw.financialYear === "string" ? raw.financialYear : "—",
      netMinor: String(raw.netMinor ?? 0),
      status: typeof raw.status === "string" ? raw.status : "unknown",
    });
  }
  return mapped;
}

async function getAssessees(): Promise<LoaderResult<AssesseeOption[]>> {
  return fetchJson<unknown, AssesseeOption[]>("/api/v1/revenue/assessees?limit=200", [], {
    telemetryKey: "revenue.adjustments.assessees",
    mapResponse: mapAssessees,
  });
}

async function getDemands(assesseeId: string): Promise<LoaderResult<DemandOption[]>> {
  return fetchJson<unknown, DemandOption[]>(
    `/api/v1/revenue/assessees/${encodeURIComponent(assesseeId)}/demands`,
    [],
    { telemetryKey: "revenue.adjustments.demands", mapResponse: mapDemands },
  );
}

export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams?: { assesseeId?: string };
}) {
  const assesseeId = searchParams?.assesseeId?.trim() || "";

  const { data: assessees, source: assesseesSource } = await getAssessees();

  const demandsResult = assesseeId
    ? await getDemands(assesseeId)
    : ({ data: [] as DemandOption[], source: "api" as const });

  const demands = demandsResult.data;

  const overallSource = assesseesSource === "error" || demandsResult.source === "error" ? "error" : "api";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Adjustments"
        subtitle="Move an outstanding balance from one demand to another for the same assessee."
        back="/revenue"
        actions={overallSource === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <Card title="Select assessee" padding>
        <form method="GET" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="adjustments-assessee-select" style={{ fontSize: 13, fontWeight: 600 }}>
              Assessee
            </label>
            <select
              id="adjustments-assessee-select"
              name="assesseeId"
              defaultValue={assesseeId}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--line)",
                minHeight: 44,
                minWidth: 280,
              }}
            >
              <option value="">Select an assessee…</option>
              {assessees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.ownerName} — {a.identifierNo} ({a.assesseeType})
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }}>
            View
          </button>
        </form>
      </Card>

      {!assesseeId ? (
        <Card title="Adjustments">
          <EmptyState
            icon="🔀"
            title="Choose an assessee"
            message="Select an assessee above to move an outstanding balance between two of their demands."
          />
        </Card>
      ) : demandsResult.source === "error" && demands.length === 0 ? (
        <Card title="Demands">
          <DataSourceBadge source="error" />
        </Card>
      ) : (
        <AdjustmentCreateForm assesseeId={assesseeId} demands={demands} />
      )}

      <Card title="Adjustment register" padding>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink2)" }}>
          revenue-service does not yet expose a list endpoint for adjustments (only{" "}
          <code>POST /v1/revenue/adjustments</code> exists — see <strong>## BACKEND FOLLOW-UPS</strong> in this PR).
          Adjustments apply immediately and have no maker-checker decide step.
        </p>
      </Card>
    </main>
  );
}
