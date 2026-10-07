/**
 * Waivers page — raise penalty/interest waivers (maker-checker).
 *
 * Server component: loads assessees (and the chosen assessee's demands) so the
 * clerk never types a UUID, the amount is capped against the demand's
 * penalty/interest, and a ConfirmDialog echoes names + FY + formatted amount
 * before posting (GAP-REVENUE-WAIVERS-01/02). Command-only (CQRS 202); the
 * checker decides via /revenue/waivers/[id]/decide (GAP-REVENUE-WAIVERS-03).
 */
import { Button, PageHeader, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { WaiverForm } from "./WaiverForm";

export type AssesseeOption = {
  id: string;
  ownerName: string;
  identifierNo: string;
  assesseeType: string;
};

export type DemandOption = {
  id: string;
  financialYear: string;
  dueDate: string;
  netMinor: string;
  penaltyMinor: string;
  interestMinor: string;
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
      dueDate: typeof raw.dueDate === "string" ? raw.dueDate : "",
      netMinor: String(raw.netMinor ?? 0),
      penaltyMinor: String(raw.penaltyMinor ?? 0),
      interestMinor: String(raw.interestMinor ?? 0),
      status: typeof raw.status === "string" ? raw.status : "unknown",
    });
  }
  return mapped;
}

async function getAssessees(): Promise<LoaderResult<AssesseeOption[]>> {
  return fetchJson<unknown, AssesseeOption[]>("/api/v1/revenue/assessees?limit=200", [], {
    telemetryKey: "revenue.waivers.assessees",
    mapResponse: mapAssessees,
  });
}

async function getDemands(assesseeId: string): Promise<LoaderResult<DemandOption[]>> {
  return fetchJson<unknown, DemandOption[]>(
    `/api/v1/revenue/assessees/${encodeURIComponent(assesseeId)}/demands`,
    [],
    { telemetryKey: "revenue.waivers.demands", mapResponse: mapDemands },
  );
}

export default async function WaiversPage({
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
  const selected = assesseeId ? assessees.find((a) => a.id === assesseeId) ?? null : null;
  const overallSource = assesseesSource === "error" || demandsResult.source === "error" ? "error" : "api";

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Waivers"
        subtitle="Raise penalty and interest waivers for assessee demands (maker-checker workflow)."
        back="/revenue"
        actions={overallSource === "error" ? <DataSourceBadge source="error" /> : null}
      />

      {assesseesSource === "error" ? (
        <Card title="Select assessee" padding>
          <RefreshErrorState error={toHumanError("load", { area: "assessees" })} backHref="/revenue" />
        </Card>
      ) : (
        <Card title="Select assessee" padding>
          <form method="GET" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="waivers-assessee-select" style={{ fontSize: 13, fontWeight: 600 }}>
                Assessee
              </label>
              <select
                id="waivers-assessee-select"
                name="assesseeId"
                defaultValue={assesseeId}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, minWidth: 280 }}
              >
                <option value="">Select an assessee…</option>
                {assessees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.ownerName} — {a.identifierNo} ({a.assesseeType})
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" style={{ minHeight: 44 }}>
              View
            </Button>
          </form>
        </Card>
      )}

      {!assesseeId ? (
        <Card title="Waivers">
          <EmptyState
            icon="🪙"
            title="Choose an assessee"
            message="Select an assessee above to raise a penalty or interest waiver against one of their demands."
          />
        </Card>
      ) : demandsResult.source === "error" ? (
        <Card title="Demands">
          <RefreshErrorState error={toHumanError("load", { area: "demands" })} backHref="/revenue" />
        </Card>
      ) : demands.length === 0 ? (
        <Card title="Waivers">
          <EmptyState
            icon="🪙"
            title="No demands on record"
            message="This assessee has no demands to waive penalty or interest against."
          />
        </Card>
      ) : (
        <WaiverForm assesseeId={assesseeId} assesseeName={selected?.ownerName ?? null} demands={demands} />
      )}

      <Card title="About Waivers" padding>
        <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0, lineHeight: 1.6 }}>
          A waiver is a partial remission of penalty or interest — it does not write off the principal demand.
          Submitted waivers require checker approval before they take effect. Use Write-offs for principal
          demand remission.
        </p>
      </Card>
    </div>
  );
}
