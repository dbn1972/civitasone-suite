import { notFound } from "next/navigation";
import { PageHeader, Card, StatusPill, RefreshErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney, formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { WaiverDecideForm } from "./WaiverDecideForm";

export type WaiverRecord = {
  id: string;
  demandId: string;
  amountMinor: string;
  reason: string;
  status: string;
  requestedBy: string;
} & Record<string, unknown>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapWaiver(payload: unknown): WaiverRecord | null {
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
    demandId: typeof body.demandId === "string" ? body.demandId : "",
    amountMinor: String(body.amountMinor ?? "0"),
    reason: typeof body.reason === "string" ? body.reason : "",
    status: typeof body.status === "string" ? body.status : "unknown",
    requestedBy: typeof body.requestedBy === "string" ? body.requestedBy : "",
  };
}

async function getWaiver(id: string): Promise<LoaderResult<WaiverRecord | null>> {
  return fetchJson<unknown, WaiverRecord | null>(`/api/v1/revenue/waivers/${encodeURIComponent(id)}`, null, {
    telemetryKey: "revenue.waivers.decide.get",
    mapResponse: mapWaiver,
  });
}

export default async function WaiverDecidePage({ params }: { params: { id: string } }) {
  const waiverId = params.id;
  const { data: waiver, source, status } = await getWaiver(waiverId);

  if (status === 404) {
    notFound();
  }
  if (source === "error" || !waiver) {
    return (
      <div className="page-main wrap">
        <PageHeader
          title="Decide Waiver"
          subtitle="Approve or reject a pending waiver. The deciding officer must differ from the officer who raised it."
          back="/revenue/waivers"
        />
        <RefreshErrorState
          error={toHumanError("load", { area: "this waiver" })}
          backHref="/revenue/waivers"
          source={{ status, area: "this waiver" }}
        />
        <WaiverDecideForm waiverId={waiverId} waiver={null} currentUserId={null} />
      </div>
    );
  }

  const currentUserId = getSessionUserId();

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Decide Waiver"
        subtitle="Approve or reject a pending waiver. The deciding officer must differ from the officer who raised it."
        back="/revenue/waivers"
      />

      <Card title="Waiver" padding>
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "max-content 1fr",
            gap: "6px 16px",
            margin: "0 0 16px",
            fontSize: 13.5,
          }}
        >
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Waiver ID</dt>
          <dd className="mono" style={{ margin: 0 }}>{waiver.id}</dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Demand</dt>
          <dd className="mono" style={{ margin: 0 }}>{waiver.demandId || "—"}</dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Amount</dt>
          <dd style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{formatMoney(waiver.amountMinor)}</dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Reason</dt>
          <dd style={{ margin: 0 }}>{waiver.reason || "—"}</dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Raised</dt>
          <dd style={{ margin: 0 }}>
            {typeof waiver.createdAt === "string" ? formatIndianDate(waiver.createdAt) : "—"}
          </dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Status</dt>
          <dd style={{ margin: 0 }}>
            <StatusPill status={waiver.status} label={humanizeStatus(waiver.status)} />
          </dd>
        </dl>
        <WaiverDecideForm waiverId={waiverId} waiver={waiver} currentUserId={currentUserId} />
      </Card>
    </div>
  );
}
