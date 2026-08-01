import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { CreateInstalmentPlanForm } from "./CreateInstalmentPlanForm";

export type AssesseeOption = {
  id: string;
  ownerName: string;
  identifierNo: string;
  assesseeType: string;
};

export type InstalmentPlanRow = {
  id: string;
  totalMinor: string;
  instalmentCount: number;
  startDate: string;
  status: string;
} & Record<string, unknown>;

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

function mapInstalmentPlans(payload: unknown): InstalmentPlanRow[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: InstalmentPlanRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    if (typeof id !== "string") continue;
    mapped.push({
      id,
      totalMinor: String(raw.totalMinor ?? 0),
      instalmentCount: typeof raw.instalmentCount === "number" ? raw.instalmentCount : Number(raw.instalmentCount ?? 0),
      startDate: typeof raw.startDate === "string" ? raw.startDate : "",
      status: typeof raw.status === "string" ? raw.status : "unknown",
    });
  }
  return mapped;
}

async function getAssessees(): Promise<LoaderResult<AssesseeOption[]>> {
  return fetchJson<unknown, AssesseeOption[]>("/api/v1/revenue/assessees?limit=200", [], {
    telemetryKey: "revenue.instalments.assessees",
    mapResponse: mapAssessees,
  });
}

async function getInstalmentPlans(assesseeId: string): Promise<LoaderResult<InstalmentPlanRow[]>> {
  return fetchJson<unknown, InstalmentPlanRow[]>(
    `/api/v1/revenue/assessees/${encodeURIComponent(assesseeId)}/instalments`,
    [],
    { telemetryKey: "revenue.instalments.list", mapResponse: mapInstalmentPlans },
  );
}

export default async function InstalmentsPage({
  searchParams,
}: {
  searchParams?: { assesseeId?: string };
}) {
  const assesseeId = searchParams?.assesseeId?.trim() || "";

  const { data: assessees, source: assesseesSource } = await getAssessees();

  const plansResult = assesseeId
    ? await getInstalmentPlans(assesseeId)
    : ({ data: [] as InstalmentPlanRow[], source: "api" as const });

  const plans = plansResult.data;

  const overallSource = assesseesSource === "error" || plansResult.source === "error" ? "error" : "api";

  const activePlans = plans.filter((p) => p.status === "active").length;

  const planRows = plans.map((p) => ({ ...p, startDateDisplay: formatIndianDate(p.startDate) }));

  const planColumns: {
    key: keyof (typeof planRows)[number] & string;
    label: string;
    align?: "right";
    cellType?: "status" | "amount";
  }[] = [
    { key: "totalMinor", label: "Total Due", align: "right", cellType: "amount" },
    { key: "instalmentCount", label: "Instalments" },
    { key: "startDateDisplay", label: "Start Date" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Instalment Plans"
        subtitle="Set up instalment plans for assessees in arrears and review existing plans."
        back="/revenue"
        actions={overallSource === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <Card title="Select assessee" padding>
        <form method="GET" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="instalments-assessee-select" style={{ fontSize: 13, fontWeight: 600 }}>
              Assessee
            </label>
            <select
              id="instalments-assessee-select"
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
        <Card title="Instalment Plans">
          <EmptyState
            icon="📆"
            title="Choose an assessee"
            message="Select an assessee above to create or view an instalment plan for their arrears."
          />
        </Card>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="📆" iconBg="#e6f0ff" label="Plans" value={plans.length} />
            <StatCard icon="✅" iconBg="#e6f7f0" label="Active Plans" value={activePlans} />
          </StatGrid>

          <CreateInstalmentPlanForm assesseeId={assesseeId} />

          <Card title="Instalment Plans">
            {plansResult.source === "error" && plans.length === 0 ? (
              <DataSourceBadge source="error" />
            ) : (
              <DataTable<(typeof planRows)[number]>
                columns={planColumns}
                rows={planRows}
                sortable
                filterable
                filterPlaceholder="Filter by status…"
                pageSize={15}
                emptyIcon="📆"
                emptyTitle="No instalment plans yet"
                emptyMessage="Create an instalment plan for this assessee using the form above."
              />
            )}
          </Card>
        </>
      )}
    </main>
  );
}
