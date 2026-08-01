import { PageHeader, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { WriteOffCreateForm } from "./WriteOffCreateForm";
import { WriteOffLookupForm } from "./WriteOffLookupForm";

export type AssesseeOption = {
  id: string;
  ownerName: string;
  identifierNo: string;
  assesseeType: string;
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

async function getAssessees(): Promise<LoaderResult<AssesseeOption[]>> {
  return fetchJson<unknown, AssesseeOption[]>("/api/v1/revenue/assessees?limit=200", [], {
    telemetryKey: "revenue.write-offs.assessees",
    mapResponse: mapAssessees,
  });
}

export default async function WriteOffsPage({
  searchParams,
}: {
  searchParams?: { assesseeId?: string };
}) {
  const assesseeId = searchParams?.assesseeId?.trim() || "";

  const { data: assessees, source: assesseesSource } = await getAssessees();

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Write-offs"
        subtitle="Write off irrecoverable arrears against an assessee, subject to checker approval."
        back="/revenue"
        actions={assesseesSource === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <Card title="Select assessee" padding>
        <form method="GET" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="write-offs-assessee-select" style={{ fontSize: 13, fontWeight: 600 }}>
              Assessee
            </label>
            <select
              id="write-offs-assessee-select"
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
        <Card title="Write-offs">
          <EmptyState
            icon="🗑️"
            title="Choose an assessee"
            message="Select an assessee above to write off part of their outstanding arrears."
          />
        </Card>
      ) : (
        <WriteOffCreateForm assesseeId={assesseeId} />
      )}

      <Card title="Write-off register" padding>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--ink2)" }}>
          revenue-service does not yet expose a list endpoint for write-offs (only{" "}
          <code>POST /v1/revenue/write-offs</code> and <code>PATCH /v1/revenue/write-offs/:id/decide</code> exist —
          see <strong>## BACKEND FOLLOW-UPS</strong> in this PR). If you already have a write-off ID from a
          submission confirmation, decide on it below.
        </p>
        <WriteOffLookupForm />
      </Card>
    </main>
  );
}
