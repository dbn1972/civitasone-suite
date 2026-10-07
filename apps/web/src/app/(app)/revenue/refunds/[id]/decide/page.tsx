import { notFound } from "next/navigation";
import { PageHeader, Card } from "@/app/_components/ds";
import { RefreshErrorState } from "@/app/_components/ds/RefreshErrorState";
import { StatusPill } from "@/app/_components/ds/StatusPill";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { formatMoney } from "@/lib/formatters";
import { channelLabel } from "@/lib/revenue/channels";
import { RefundDecideForm } from "./RefundDecideForm";

export type RefundRecord = {
  id: string;
  receiptId: string;
  assesseeId: string;
  amountMinor: string;
  reason: string;
  status: string;
  makerUserId: string;
} & Record<string, unknown>;

type AssesseeInfo = { ownerName: string; identifierNo: string };
type ReceiptInfo = { receiptNo: string; amountMinor: string; channel: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapRefund(payload: unknown): RefundRecord | null {
  const body = isRecord(payload)
    ? isRecord((payload as { data?: unknown }).data)
      ? ((payload as { data: Record<string, unknown> }).data)
      : payload
    : null;
  if (!body) return null;
  const id = body.id;
  if (typeof id !== "string") return null;
  return {
    id,
    receiptId: typeof body.receiptId === "string" ? body.receiptId : "",
    assesseeId: typeof body.assesseeId === "string" ? body.assesseeId : "",
    amountMinor: String(body.amountMinor ?? "0"),
    reason: typeof body.reason === "string" ? body.reason : "",
    status: typeof body.status === "string" ? body.status : "unknown",
    makerUserId: typeof body.makerUserId === "string" ? body.makerUserId : "",
  };
}

function mapAssessee(payload: unknown): AssesseeInfo | null {
  const body = isRecord(payload)
    ? isRecord((payload as { data?: unknown }).data)
      ? (payload as { data: Record<string, unknown> }).data
      : payload
    : null;
  if (!body || typeof body.id !== "string") return null;
  return {
    ownerName: typeof body.ownerName === "string" ? body.ownerName : "—",
    identifierNo: typeof body.identifierNo === "string" ? body.identifierNo : "—",
  };
}

function arrayFromPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: unknown[] }).data;
  }
  return null;
}

function mapReceipts(payload: unknown): ReceiptInfo[] | null {
  const rows = arrayFromPayload(payload);
  if (!rows) return null;
  const mapped: ReceiptInfo[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const id = raw.id;
    if (typeof id !== "string") continue;
    mapped.push({
      // keep id alongside the display fields via a cast below
      ...(raw as object),
      receiptNo: typeof raw.receiptNo === "string" ? raw.receiptNo : "—",
      amountMinor: String(raw.amountMinor ?? "0"),
      channel: typeof raw.channel === "string" ? raw.channel : "—",
    } as ReceiptInfo & { id: string });
  }
  return mapped;
}

async function getRefund(id: string): Promise<LoaderResult<RefundRecord | null>> {
  return fetchJson<unknown, RefundRecord | null>(`/api/v1/revenue/refunds/${encodeURIComponent(id)}`, null, {
    telemetryKey: "revenue.refunds.decide.get",
    mapResponse: mapRefund,
  });
}

async function getAssessee(id: string): Promise<LoaderResult<AssesseeInfo | null>> {
  return fetchJson<unknown, AssesseeInfo | null>(`/api/v1/revenue/assessees/${encodeURIComponent(id)}`, null, {
    telemetryKey: "revenue.refunds.decide.assessee",
    mapResponse: mapAssessee,
  });
}

async function getReceipts(assesseeId: string): Promise<LoaderResult<Array<ReceiptInfo & { id: string }>>> {
  return fetchJson<unknown, Array<ReceiptInfo & { id: string }>>(
    `/api/v1/revenue/assessees/${encodeURIComponent(assesseeId)}/receipts`,
    [],
    { telemetryKey: "revenue.refunds.decide.receipts", mapResponse: mapReceipts as (p: unknown) => Array<ReceiptInfo & { id: string }> | null },
  );
}

export default async function RefundDecidePage({ params }: { params: { id: string } }) {
  const refundId = params.id;
  const currentUserId = getSessionUserId();
  const { data: refund, source, status } = await getRefund(refundId);

  // GAP-REVENUE-REFUNDS-DETAIL-DECIDE-04: distinguish a real 404 (this refund
  // does not exist) from a transient failure. A 404 renders the standard
  // not-found page; any other failure (5xx/network/401/403) renders a retry
  // state, not a not-found.
  if (status === 404 || (!refund && source !== "error")) {
    notFound();
  }
  if (!refund || source === "error") {
    return (
      <div className="page-main wrap">
        <PageHeader
          title="Decide Refund"
          subtitle="Approve or reject a pending refund."
          back="/revenue/refunds"
        />
        <Card title="Refund" padding>
          <RefreshErrorState
            error={{
              what: "We couldn't load this refund.",
              next: "Retry in a moment. If it keeps failing, the revenue service may be unavailable.",
              actions: ["retry", "back"],
            }}
            backHref="/revenue/refunds"
            source={{ status, area: "revenue" }}
          />
          <RefundDecideForm refundId={refundId} refund={null} currentUserId={currentUserId} />
        </Card>
      </div>
    );
  }

  // GAP-REVENUE-REFUNDS-DETAIL-DECIDE-03: resolve the payer + receipt so the
  // checker sees names/numbers, not raw UUIDs. Parallelised; failures degrade
  // to "—" rather than blocking the decision (the refund core fields loaded).
  const [assesseeResult, receiptsResult] = await Promise.all([
    refund.assesseeId ? getAssessee(refund.assesseeId) : Promise.resolve({ data: null, source: "api" as const }),
    refund.assesseeId ? getReceipts(refund.assesseeId) : Promise.resolve({ data: [] as Array<ReceiptInfo & { id: string }>, source: "api" as const }),
  ]);
  const assessee = assesseeResult.data;
  const matchedReceipt = receiptsResult.data.find((r) => r.id === refund.receiptId) ?? null;
  const assesseeName = assessee ? `${assessee.ownerName} (${assessee.identifierNo})` : "—";
  const receiptNo = matchedReceipt?.receiptNo ?? "—";

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Decide Refund"
        subtitle="Approve or reject a pending refund. The deciding officer must differ from the officer who raised it."
        back="/revenue/refunds"
      />

      <Card title="Refund" padding>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "max-content 1fr",
            gap: "6px 16px",
            margin: "0 0 16px",
            fontSize: 13.5,
          }}
        >
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Amount</dt>
          <dd style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{formatMoney(refund.amountMinor)}</dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Assessee</dt>
          <dd style={{ margin: 0 }}>{assesseeName}</dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Receipt</dt>
          <dd style={{ margin: 0 }}>
            {receiptNo}
            {matchedReceipt ? ` — ${formatMoney(matchedReceipt.amountMinor)} (${channelLabel(matchedReceipt.channel)})` : ""}
          </dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Reason</dt>
          <dd style={{ margin: 0 }}>{refund.reason || "—"}</dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Status</dt>
          <dd style={{ margin: 0 }}>
            <StatusPill status={refund.status} />
          </dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Ref</dt>
          <dd className="mono" style={{ margin: 0, color: "var(--mut)", fontSize: 12 }}>
            {refund.id}
          </dd>
        </dl>
        <RefundDecideForm
          refundId={refundId}
          refund={refund}
          currentUserId={currentUserId}
          assesseeName={assesseeName}
          receiptNo={receiptNo}
        />
      </Card>
    </div>
  );
}
