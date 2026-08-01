import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { RefundCreateForm } from "./RefundCreateForm";
import { RefundLookupForm } from "./RefundLookupForm";

export type AssesseeOption = {
  id: string;
  ownerName: string;
  identifierNo: string;
  assesseeType: string;
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
    telemetryKey: "revenue.refunds.assessees",
    mapResponse: mapAssessees,
  });
}

async function getReceipts(assesseeId: string): Promise<LoaderResult<ReceiptRow[]>> {
  return fetchJson<unknown, ReceiptRow[]>(
    `/api/v1/revenue/assessees/${encodeURIComponent(assesseeId)}/receipts`,
    [],
    { telemetryKey: "revenue.refunds.receipts", mapResponse: mapReceipts },
  );
}

export default async function RefundsPage({
  searchParams,
}: {
  searchParams?: { assesseeId?: string };
}) {
  const assesseeId = searchParams?.assesseeId?.trim() || "";

  const { data: assessees, source: assesseesSource } = await getAssessees();

  const receiptsResult = assesseeId
    ? await getReceipts(assesseeId)
    : ({ data: [] as ReceiptRow[], source: "api" as const });

  const receipts = receiptsResult.data;

  const overallSource = assesseesSource === "error" || receiptsResult.source === "error" ? "error" : "api";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Refunds"
        subtitle="Raise refunds against collection receipts and route them through checker approval."
        back="/revenue"
        actions={overallSource === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <Card title="Select assessee" padding>
        <form method="GET" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="refunds-assessee-select" style={{ fontSize: 13, fontWeight: 600 }}>
              Assessee
            </label>
            <select
              id="refunds-assessee-select"
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
        <Card title="Refunds">
          <EmptyState
            icon="↩️"
            title="Choose an assessee"
            message="Select an assessee above to raise a refund against one of their collection receipts."
          />
        </Card>
      ) : (
        <>
          <StatGrid>
            <StatCard icon="🧾" iconBg="#e6f0ff" label="Receipts on record" value={receipts.length} />
          </StatGrid>

          {receiptsResult.source === "error" && receipts.length === 0 ? (
            <Card title="Receipts">
              <DataSourceBadge source="error" />
            </Card>
          ) : (
            <RefundCreateForm assesseeId={assesseeId} receipts={receipts} />
          )}
        </>
      )}

      <Card title="Refund register" padding>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--ink2)" }}>
          revenue-service does not yet expose a list endpoint for refunds (only <code>POST /v1/revenue/refunds</code>{" "}
          and <code>PATCH /v1/revenue/refunds/:id/decide</code> exist — see{" "}
          <strong>## BACKEND FOLLOW-UPS</strong> in this PR). If you already have a refund ID from a submission
          confirmation, decide on it below.
        </p>
        <RefundLookupForm />
      </Card>
    </main>
  );
}
