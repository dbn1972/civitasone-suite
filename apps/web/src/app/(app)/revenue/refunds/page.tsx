import { Button, PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { RefreshErrorState } from "@/app/_components/ds/RefreshErrorState";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDateTime, formatMoney } from "@/lib/formatters";
import { RefundCreateForm } from "./RefundCreateForm";
import { RefundLookupForm } from "./RefundLookupForm";

export type AssesseeOption = {
  id: string;
  ownerName: string;
  identifierNo: string;
  assesseeType: string;
};

export type PendingRefundRow = {
  id: string;
  receiptId: string;
  assesseeId: string;
  amountMinor: string;
  reason: string;
  status: string | null;
  createdAt: string;
} & Record<string, unknown>;

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

function mapPendingRefunds(payload: unknown): PendingRefundRow[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: PendingRefundRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    if (typeof id !== "string") continue;
    mapped.push({
      id,
      receiptId: typeof raw.receiptId === "string" ? raw.receiptId : "",
      assesseeId: typeof raw.assesseeId === "string" ? raw.assesseeId : "",
      amountMinor: String(raw.amountMinor ?? 0),
      reason: typeof raw.reason === "string" ? raw.reason : "—",
      status: typeof raw.status === "string" ? raw.status : null,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    });
  }
  return mapped;
}

async function getPendingRefunds(): Promise<LoaderResult<PendingRefundRow[]>> {
  return fetchJson<unknown, PendingRefundRow[]>("/api/v1/revenue/refunds?status=pending&limit=200", [], {
    telemetryKey: "revenue.refunds.pending",
    mapResponse: mapPendingRefunds,
  });
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

  const pendingResult = await getPendingRefunds();
  const pendingRefunds = pendingResult.data;
  const pendingRows = pendingRefunds.map((r) => ({
    ...r,
    createdAtDisplay: formatIndianDateTime(r.createdAt),
    amountDisplay: formatMoney(r.amountMinor),
    decidePath: `/revenue/refunds/${r.id}/decide`,
  }));

  const overallSource = assesseesSource === "error" || receiptsResult.source === "error" ? "error" : "api";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
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
          <Button type="submit" style={{ minHeight: 44 }}>
            View
          </Button>
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
            <StatCard
              icon="🧾"
              iconBg="#e6f0ff"
              label="Receipts on record"
              value={receiptsResult.source === "error" ? "—" : receipts.length}
            />
          </StatGrid>

          {receiptsResult.source === "error" ? (
            <Card title="Receipts">
              <DataSourceBadge source="error" />
            </Card>
          ) : (
            <RefundCreateForm
              assesseeId={assesseeId}
              receipts={receipts}
              pendingRefundReceiptIds={pendingRefunds
                .map((r) => r.receiptId)
                .filter((x): x is string => typeof x === "string" && x.length > 0)}
            />
          )}
        </>
      )}

      <Card title="Pending approval" padding>
        {pendingResult.source === "error" ? (
          <RefreshErrorState
            error={{
              what: "We couldn't load refunds awaiting approval.",
              next: "Retry in a moment. If it keeps failing, the revenue service may be unavailable.",
              actions: ["retry", "back"],
            }}
            backHref="/revenue"
          />
        ) : (
          <DataTable<(typeof pendingRows)[number]>
            columns={[
              { key: "amountDisplay", label: "Amount", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "reason", label: "Reason" },
              { key: "createdAtDisplay", label: "Raised On" },
            ]}
            rows={pendingRows}
            rowLinkKey="decidePath"
            rowLinkPrefix=""
            sortable
            filterable
            filterPlaceholder="Filter by reason…"
            pageSize={15}
            emptyIcon="↩️"
            emptyTitle="No refunds awaiting approval"
            emptyMessage="Refunds raised by makers appear here for a checker to approve or reject."
          />
        )}
      </Card>

      <Card title="Find a refund by reference" padding>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--ink2)" }}>
          If you already have a refund reference, open it directly to decide on it.
        </p>
        <RefundLookupForm />
      </Card>
    </div>
  );
}
