import { PageHeader, Card } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { WriteOffDecideForm } from "./WriteOffDecideForm";

export type WriteOffRecord = {
  id: string;
  assesseeId: string;
  amountMinor: string;
  reason: string;
  status: string;
  makerUserId: string;
} & Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapWriteOff(payload: unknown): WriteOffRecord | null {
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
    assesseeId: typeof body.assesseeId === "string" ? body.assesseeId : "",
    amountMinor: String(body.amountMinor ?? "0"),
    reason: typeof body.reason === "string" ? body.reason : "",
    status: typeof body.status === "string" ? body.status : "unknown",
    makerUserId: typeof body.makerUserId === "string" ? body.makerUserId : "",
  };
}

async function getWriteOff(id: string): Promise<LoaderResult<WriteOffRecord | null>> {
  return fetchJson<unknown, WriteOffRecord | null>(`/api/v1/revenue/write-offs/${encodeURIComponent(id)}`, null, {
    telemetryKey: "revenue.write-offs.decide.get",
    mapResponse: mapWriteOff,
  });
}

export default async function WriteOffDecidePage({ params }: { params: { id: string } }) {
  const writeOffId = params.id;
  const { data: writeOff, source } = await getWriteOff(writeOffId);
  // Fail closed: if we could not load the record (network/auth error, or the
  // id simply doesn't exist), never let the checker approve/reject blind.
  const loadFailed = source === "error" || !writeOff;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Decide Write-off"
        subtitle="Approve or reject a pending write-off. The deciding officer must differ from the officer who raised it."
        back="/revenue/write-offs"
        actions={loadFailed ? <DataSourceBadge source="error" /> : null}
      />

      <Card title="Write-off" padding>
        {loadFailed ? (
          <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "var(--ink2)" }}>
            Could not load write-off <span className="mono">{writeOffId}</span> — the amount, assessee, and reason
            are not available, so approving or rejecting is disabled below. Never decide on a write-off you cannot
            see the details of.
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
            <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Write-off ID</dt>
            <dd className="mono" style={{ margin: 0 }}>
              {writeOff.id}
            </dd>
            <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Amount</dt>
            <dd style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{formatMoney(writeOff.amountMinor)}</dd>
            <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Assessee</dt>
            <dd className="mono" style={{ margin: 0 }}>
              {writeOff.assesseeId || "—"}
            </dd>
            <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Reason</dt>
            <dd style={{ margin: 0 }}>{writeOff.reason || "—"}</dd>
            <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Status</dt>
            <dd style={{ margin: 0 }}>{writeOff.status}</dd>
          </dl>
        )}
        <WriteOffDecideForm writeOffId={writeOffId} writeOff={loadFailed ? null : writeOff} />
      </Card>
    </main>
  );
}
