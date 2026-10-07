import { PageHeader, Card, DataTable, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatIndianDateTime } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { FetchBillForm } from "./FetchBillForm";
import { PayBillForm } from "./PayBillForm";

export type BbpsRequestRow = {
  id: string;
  bbpsTxnId: string;
  status: string;
  requestType: string | null;
  amountMinor: string;
  failureReason: string | null;
  createdAt: string;
} & Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapRequests(payload: unknown): BbpsRequestRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : null;
  if (!rows) return null;
  const mapped: BbpsRequestRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    if (typeof raw.id !== "string") continue;
    mapped.push({
      id: raw.id,
      bbpsTxnId: typeof raw.bbpsTxnId === "string" ? raw.bbpsTxnId : "—",
      status: typeof raw.status === "string" ? raw.status : "pending",
      requestType: typeof raw.requestType === "string" ? raw.requestType : null,
      amountMinor: String(raw.amountMinor ?? 0),
      failureReason: typeof raw.failureReason === "string" ? raw.failureReason : null,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    });
  }
  return mapped;
}

async function getRecentRequests(): Promise<LoaderResult<BbpsRequestRow[]>> {
  return fetchJson<unknown, BbpsRequestRow[]>("/api/v1/revenue/bbps/requests?limit=20", [], {
    telemetryKey: "revenue.bbps.requests",
    mapResponse: mapRequests,
  });
}

export default async function BbpsPage() {
  const { data: requests, source } = await getRecentRequests();
  // Display strings are precomputed here: DataTable is a client component, and a
// Server Component cannot pass `render` functions across the RSC boundary.
  const rows = requests.map((r) => ({
    ...r,
    createdAtDisplay: r.createdAt ? formatIndianDateTime(r.createdAt) : "—",
    requestTypeDisplay: r.requestType ?? "—",
    failureReasonDisplay: r.failureReason ?? "—",
  }));

  return (
    <div className="page-main wrap">
      <PageHeader
        title="BBPS Bill Fetch & Pay"
        subtitle="Fetch an assessee's outstanding bill via Bharat Bill Payment System and record a BBPS payment against it."
        back="/revenue"
      />

      <Card title="About this screen" padding>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink2)" }}>
          BBPS requests are processed asynchronously by the biller adapter. After you submit a request, this
          screen tracks its outcome (pending → success or failed) and, on a successful payment, links you to the
          resulting receipt. Recent requests and their status are also listed below.
        </p>
      </Card>

      <FetchBillForm />
      <PayBillForm />

      <Card title="Recent BBPS requests" padding>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "recent BBPS requests" })} backHref="/revenue" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="No BBPS requests yet"
            message="Fetch or pay a bill above; each request and its outcome will appear here."
          />
        ) : (
          <DataTable<(typeof rows)[number]>
            columns={[
              { key: "createdAtDisplay", label: "When" },
              { key: "requestTypeDisplay", label: "Type" },
              { key: "bbpsTxnId", label: "BBPS Txn" },
              { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "failureReasonDisplay", label: "Detail" },
            ]}
            rows={rows}
            sortable
            pageSize={10}
            emptyIcon="🧾"
            emptyTitle="No BBPS requests yet"
            emptyMessage="Fetch or pay a bill above; each request and its outcome will appear here."
          />
        )}
      </Card>
    </div>
  );
}
