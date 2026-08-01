import { PageHeader, Card } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
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

async function getRefund(id: string): Promise<LoaderResult<RefundRecord | null>> {
  return fetchJson<unknown, RefundRecord | null>(`/api/v1/revenue/refunds/${encodeURIComponent(id)}`, null, {
    telemetryKey: "revenue.refunds.decide.get",
    mapResponse: mapRefund,
  });
}

export default async function RefundDecidePage({ params }: { params: { id: string } }) {
  const refundId = params.id;
  const { data: refund, source } = await getRefund(refundId);
  // Fail closed: if we could not load the record (network/auth error, or the
  // id simply doesn't exist), never let the checker approve/reject blind.
  const loadFailed = source === "error" || !refund;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Decide Refund"
        subtitle="Approve or reject a pending refund. The deciding officer must differ from the officer who raised it."
        back="/revenue/refunds"
        actions={loadFailed ? <DataSourceBadge source="error" /> : null}
      />

      <Card title="Refund" padding>
        {loadFailed ? (
          <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "var(--ink2)" }}>
            Could not load refund <span className="mono">{refundId}</span> — the amount, receipt, and reason are
            not available, so approving or rejecting is disabled below. Never decide on a refund you cannot see the
            details of.
          </p>
        ) : (
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "max-content 1fr",
              gap: "6px 16px",
              margin: "0 0 16px",
              fontSize: 13.5,
            }}
          >
            <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Refund ID</dt>
            <dd className="mono" style={{ margin: 0 }}>
              {refund.id}
            </dd>
            <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Amount</dt>
            <dd style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{formatMoney(refund.amountMinor)}</dd>
            <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Receipt</dt>
            <dd className="mono" style={{ margin: 0 }}>
              {refund.receiptId || "—"}
            </dd>
            <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Assessee</dt>
            <dd className="mono" style={{ margin: 0 }}>
              {refund.assesseeId || "—"}
            </dd>
            <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Reason</dt>
            <dd style={{ margin: 0 }}>{refund.reason || "—"}</dd>
            <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Status</dt>
            <dd style={{ margin: 0 }}>{refund.status}</dd>
          </dl>
        )}
        <RefundDecideForm refundId={refundId} refund={loadFailed ? null : refund} />
      </Card>
    </main>
  );
}
