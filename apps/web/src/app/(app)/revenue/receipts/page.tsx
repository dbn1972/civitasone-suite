import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { RecordReceiptForm } from "./RecordReceiptForm";

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

export type ReceiptRow = {
  id: string;
  receiptNo: string;
  demandId: string;
  amountMinor: string;
  channel: string;
  reference: string;
  status: string;
  createdAt: string;
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

function mapReceipts(payload: unknown): ReceiptRow[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: ReceiptRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    if (typeof id !== "string") continue;
    mapped.push({
      id,
      receiptNo: typeof raw.receiptNo === "string" ? raw.receiptNo : "—",
      demandId: typeof raw.demandId === "string" ? raw.demandId : "",
      amountMinor: String(raw.amountMinor ?? 0),
      channel: typeof raw.channel === "string" ? raw.channel : "—",
      reference: typeof raw.reference === "string" ? raw.reference : "—",
      status: typeof raw.status === "string" ? raw.status : "unknown",
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    });
  }
  return mapped;
}

async function getAssessees(): Promise<LoaderResult<AssesseeOption[]>> {
  return fetchJson<unknown, AssesseeOption[]>("/api/v1/revenue/assessees?limit=200", [], {
    telemetryKey: "revenue.receipts.assessees",
    mapResponse: mapAssessees,
  });
}

async function getDemands(assesseeId: string): Promise<LoaderResult<DemandOption[]>> {
  return fetchJson<unknown, DemandOption[]>(
    `/api/v1/revenue/assessees/${encodeURIComponent(assesseeId)}/demands`,
    [],
    { telemetryKey: "revenue.receipts.demands", mapResponse: mapDemands },
  );
}

async function getReceipts(assesseeId: string): Promise<LoaderResult<ReceiptRow[]>> {
  return fetchJson<unknown, ReceiptRow[]>(
    `/api/v1/revenue/assessees/${encodeURIComponent(assesseeId)}/receipts`,
    [],
    { telemetryKey: "revenue.receipts.list", mapResponse: mapReceipts },
  );
}

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams?: { assesseeId?: string };
}) {
  const assesseeId = searchParams?.assesseeId?.trim() || "";

  const { data: assessees, source: assesseesSource } = await getAssessees();

  const demandsResult = assesseeId
    ? await getDemands(assesseeId)
    : ({ data: [] as DemandOption[], source: "api" as const });
  const receiptsResult = assesseeId
    ? await getReceipts(assesseeId)
    : ({ data: [] as ReceiptRow[], source: "api" as const });

  const demands = demandsResult.data;
  const receipts = receiptsResult.data;

  const overallSource =
    assesseesSource === "error" || demandsResult.source === "error" || receiptsResult.source === "error"
      ? "error"
      : "api";

  const totalCollectedMinor = receipts.reduce((sum, r) => {
    try {
      return sum + BigInt(r.amountMinor);
    } catch {
      return sum;
    }
  }, 0n);
  const reconciledCount = receipts.filter((r) => r.status === "reconciled").length;

  const receiptRows = receipts.map((r) => ({ ...r, createdAtDisplay: formatIndianDate(r.createdAt) }));

  const receiptColumns: {
    key: keyof (typeof receiptRows)[number] & string;
    label: string;
    align?: "right";
    cellType?: "status" | "amount";
  }[] = [
    { key: "receiptNo", label: "Receipt No." },
    { key: "channel", label: "Channel" },
    { key: "reference", label: "Reference" },
    { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
    { key: "status", label: "Status", cellType: "status" },
    { key: "createdAtDisplay", label: "Recorded On" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Collection Receipts"
        subtitle="Record tax collection receipts against demands and review an assessee's receipt history."
        back="/revenue"
        actions={overallSource === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <Card title="Select assessee" padding>
        <form method="GET" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="receipts-assessee-select" style={{ fontSize: 13, fontWeight: 600 }}>
              Assessee
            </label>
            <select
              id="receipts-assessee-select"
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
        <Card title="Receipts">
          <EmptyState
            icon="🧾"
            title="Choose an assessee"
            message="Select an assessee above to record a receipt or view their collection history."
          />
        </Card>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="🧾" iconBg="#e6f0ff" label="Receipts" value={receipts.length} />
            <StatCard icon="💰" iconBg="#e6f7f0" label="Total Collected" value={formatMoney(totalCollectedMinor)} />
            <StatCard icon="🔗" iconBg="#fff2e6" label="Reconciled" value={reconciledCount} />
          </StatGrid>

          <RecordReceiptForm assesseeId={assesseeId} demands={demands} />

          <Card title="Receipts">
            {receiptsResult.source === "error" && receipts.length === 0 ? (
              <DataSourceBadge source="error" />
            ) : (
              <DataTable<(typeof receiptRows)[number]>
                columns={receiptColumns}
                rows={receiptRows}
                sortable
                filterable
                filterPlaceholder="Filter by receipt number…"
                pageSize={15}
                emptyIcon="🧾"
                emptyTitle="No receipts recorded"
                emptyMessage="Record a collection receipt against a demand using the form above."
              />
            )}
          </Card>
        </>
      )}
    </main>
  );
}
