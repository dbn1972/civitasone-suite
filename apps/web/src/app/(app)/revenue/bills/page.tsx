import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { GenerateBillForm } from "./GenerateBillForm";

export type AssesseeOption = {
  id: string;
  ownerName: string;
  identifierNo: string;
  assesseeType: string;
};

export type DemandRow = {
  id: string;
  assessmentId: string;
  financialYear: string;
  dueDate: string;
  principalMinor: string;
  rebateMinor: string;
  penaltyMinor: string;
  interestMinor: string;
  netMinor: string;
  status: string;
} & Record<string, unknown>;

export type BillRow = {
  id: string;
  billNo: string;
  billDate: string;
  dueDate: string;
  totalMinor: string;
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
    const identifierNo = raw.identifierNo;
    const assesseeType = raw.assesseeType;
    if (typeof id !== "string" || typeof ownerName !== "string") continue;
    mapped.push({
      id,
      ownerName,
      identifierNo: typeof identifierNo === "string" ? identifierNo : "—",
      assesseeType: typeof assesseeType === "string" ? assesseeType : "—",
    });
  }
  return mapped;
}

function mapDemands(payload: unknown): DemandRow[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: DemandRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    const assessmentId = raw.assessmentId;
    if (typeof id !== "string" || typeof assessmentId !== "string") continue;
    mapped.push({
      id,
      assessmentId,
      financialYear: typeof raw.financialYear === "string" ? raw.financialYear : "—",
      dueDate: typeof raw.dueDate === "string" ? raw.dueDate : "",
      principalMinor: String(raw.principalMinor ?? 0),
      rebateMinor: String(raw.rebateMinor ?? 0),
      penaltyMinor: String(raw.penaltyMinor ?? 0),
      interestMinor: String(raw.interestMinor ?? 0),
      netMinor: String(raw.netMinor ?? 0),
      status: typeof raw.status === "string" ? raw.status : "unknown",
    });
  }
  return mapped;
}

function mapBills(payload: unknown): BillRow[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: BillRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    const billNo = raw.billNo;
    if (typeof id !== "string" || typeof billNo !== "string") continue;
    mapped.push({
      id,
      billNo,
      billDate: typeof raw.billDate === "string" ? raw.billDate : "",
      dueDate: typeof raw.dueDate === "string" ? raw.dueDate : "",
      totalMinor: String(raw.totalMinor ?? 0),
      status: typeof raw.status === "string" ? raw.status : "unknown",
    });
  }
  return mapped;
}

async function getAssessees(): Promise<LoaderResult<AssesseeOption[]>> {
  return fetchJson<unknown, AssesseeOption[]>("/api/v1/revenue/assessees?limit=200", [], {
    telemetryKey: "revenue.bills.assessees",
    mapResponse: mapAssessees,
  });
}

async function getDemands(assesseeId: string): Promise<LoaderResult<DemandRow[]>> {
  return fetchJson<unknown, DemandRow[]>(
    `/api/v1/revenue/assessees/${encodeURIComponent(assesseeId)}/demands`,
    [],
    { telemetryKey: "revenue.bills.demands", mapResponse: mapDemands },
  );
}

async function getBills(assesseeId: string): Promise<LoaderResult<BillRow[]>> {
  return fetchJson<unknown, BillRow[]>(
    `/api/v1/revenue/assessees/${encodeURIComponent(assesseeId)}/bills`,
    [],
    { telemetryKey: "revenue.bills.list", mapResponse: mapBills },
  );
}

export default async function BillsPage({
  searchParams,
}: {
  searchParams?: { assesseeId?: string };
}) {
  const assesseeId = searchParams?.assesseeId?.trim() || "";

  const { data: assessees, source: assesseesSource } = await getAssessees();

  const demandsResult = assesseeId
    ? await getDemands(assesseeId)
    : ({ data: [] as DemandRow[], source: "api" as const });
  const billsResult = assesseeId
    ? await getBills(assesseeId)
    : ({ data: [] as BillRow[], source: "api" as const });

  const demands = demandsResult.data;
  const bills = billsResult.data;

  const overallSource =
    assesseesSource === "error" || demandsResult.source === "error" || billsResult.source === "error"
      ? "error"
      : "api";

  const outstandingDemands = demands.filter((d) => d.status !== "paid").length;

  const demandRows = demands.map((d) => ({ ...d, dueDateDisplay: formatIndianDate(d.dueDate) }));
  const billRows = bills.map((b) => ({
    ...b,
    billDateDisplay: formatIndianDate(b.billDate),
    dueDateDisplay: formatIndianDate(b.dueDate),
  }));

  const demandColumns: {
    key: keyof (typeof demandRows)[number] & string;
    label: string;
    align?: "right";
    cellType?: "status" | "amount";
  }[] = [
    { key: "financialYear", label: "Financial Year" },
    { key: "dueDateDisplay", label: "Due Date" },
    { key: "principalMinor", label: "Principal", align: "right", cellType: "amount" },
    { key: "rebateMinor", label: "Rebate", align: "right", cellType: "amount" },
    { key: "penaltyMinor", label: "Penalty", align: "right", cellType: "amount" },
    { key: "interestMinor", label: "Interest", align: "right", cellType: "amount" },
    { key: "netMinor", label: "Net Due", align: "right", cellType: "amount" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  const billColumns: {
    key: keyof (typeof billRows)[number] & string;
    label: string;
    align?: "right";
    cellType?: "status" | "amount";
  }[] = [
    { key: "billNo", label: "Bill No." },
    { key: "billDateDisplay", label: "Bill Date" },
    { key: "dueDateDisplay", label: "Due Date" },
    { key: "totalMinor", label: "Total", align: "right", cellType: "amount" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Bills & Demands"
        subtitle="Generate municipal tax bills from raised demands and review issued bills for an assessee."
        back="/revenue"
        actions={overallSource === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <Card title="Select assessee" padding>
        <form method="GET" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="bills-assessee-select" style={{ fontSize: 13, fontWeight: 600 }}>
              Assessee
            </label>
            <select
              id="bills-assessee-select"
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
        <Card title="Demands & Bills">
          <EmptyState
            icon="🧾"
            title="Choose an assessee"
            message="Select an assessee above to view raised demands and issued bills."
          />
        </Card>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="📋" iconBg="#e6f0ff" label="Demands" value={demands.length} />
            <StatCard icon="⏳" iconBg="#fff2e6" label="Outstanding Demands" value={outstandingDemands} />
            <StatCard icon="🧾" iconBg="#e6f7f0" label="Bills Issued" value={bills.length} />
          </StatGrid>

          <GenerateBillForm assesseeId={assesseeId} demands={demands} />

          <Card title="Demands">
            {demandsResult.source === "error" && demands.length === 0 ? (
              <DataSourceBadge source="error" />
            ) : (
              <DataTable<(typeof demandRows)[number]>
                columns={demandColumns}
                rows={demandRows}
                sortable
                filterable
                filterPlaceholder="Filter by financial year…"
                pageSize={15}
                emptyIcon="📋"
                emptyTitle="No demands raised"
                emptyMessage="No demands have been raised yet for this assessee."
              />
            )}
          </Card>

          <Card title="Bills Issued">
            {billsResult.source === "error" && bills.length === 0 ? (
              <DataSourceBadge source="error" />
            ) : (
              <DataTable<(typeof billRows)[number]>
                columns={billColumns}
                rows={billRows}
                sortable
                filterable
                filterPlaceholder="Filter by bill number…"
                pageSize={15}
                emptyIcon="🧾"
                emptyTitle="No bills issued"
                emptyMessage="Generate a bill from a demand above."
              />
            )}
          </Card>
        </>
      )}
    </main>
  );
}
