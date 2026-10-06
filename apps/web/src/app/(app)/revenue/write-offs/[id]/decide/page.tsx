import { notFound } from "next/navigation";
import { PageHeader, Card, StatusPill, RefreshErrorState } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { WriteOffDecideForm } from "./WriteOffDecideForm";

export type WriteOffRecord = {
  id: string;
  assesseeId: string;
  amountMinor: string;
  reason: string;
  status: string;
  makerUserId: string;
  demandId: string | null;
  financialYear: string | null;
} & Record<string, unknown>;

// Minimal shapes reused from the assessee detail page (same endpoints).
type AssesseeInfo = { ownerName: string; identifierNo: string };
type DcbSummary = { totalDemand: string; totalCollected: string; balance: string };

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
    demandId: typeof body.demandId === "string" ? body.demandId : null,
    financialYear: typeof body.financialYear === "string" ? body.financialYear : null,
  };
}

async function getWriteOff(id: string): Promise<LoaderResult<WriteOffRecord | null>> {
  return fetchJson<unknown, WriteOffRecord | null>(`/api/v1/revenue/write-offs/${encodeURIComponent(id)}`, null, {
    telemetryKey: "revenue.write-offs.decide.get",
    mapResponse: mapWriteOff,
  });
}

async function getAssessee(id: string): Promise<LoaderResult<AssesseeInfo | null>> {
  return fetchJson<unknown, AssesseeInfo | null>(`/api/v1/revenue/assessees/${encodeURIComponent(id)}`, null, {
    telemetryKey: "revenue.write-offs.decide.assessee",
    mapResponse: (p) => {
      const d = (p as { data?: Record<string, unknown> })?.data;
      if (!isRecord(d) || typeof d.ownerName !== "string") return null;
      return { ownerName: d.ownerName, identifierNo: typeof d.identifierNo === "string" ? d.identifierNo : "—" };
    },
  });
}

async function getDcb(id: string): Promise<LoaderResult<DcbSummary | null>> {
  return fetchJson<unknown, DcbSummary | null>(`/api/v1/revenue/assessees/${encodeURIComponent(id)}/dcb`, null, {
    telemetryKey: "revenue.write-offs.decide.dcb",
    mapResponse: (p) => {
      const d = (p as { data?: DcbSummary })?.data;
      return d && typeof d.balance === "string" ? d : null;
    },
  });
}

export default async function WriteOffDecidePage({ params }: { params: { id: string } }) {
  const writeOffId = params.id;
  const { data: writeOff, source, status } = await getWriteOff(writeOffId);

  // GAP-REVENUE-WRITE-OFFS-DETAIL-DECIDE-04: distinguish not-found from a server
  // error. A 404 (unknown id) is a genuine not-found page; a transport/server
  // error gets a retry state. Previously both shared one fail-closed message.
  if (status === 404) {
    notFound();
  }
  if (source === "error" || !writeOff) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader
          title="Decide Write-off"
          subtitle="Approve or reject a pending write-off. The deciding officer must differ from the officer who raised it."
          back="/revenue/write-offs"
        />
        <RefreshErrorState
          error={toHumanError("load", { area: "this write-off" })}
          backHref="/revenue/write-offs"
          source={{ status, area: "this write-off" }}
        />
        {/* Keep the form present but disabled so the fail-closed contract holds. */}
        <WriteOffDecideForm writeOffId={writeOffId} writeOff={null} currentUserId={null} />
      </div>
    );
  }

  // GAP-REVENUE-WRITE-OFFS-DETAIL-DECIDE-02: show the checker the assessee name
  // and outstanding arrears (and the balance after this write-off) instead of a
  // bare UUID. A dcb/name fetch failure renders "—" but never blocks on missing
  // core write-off fields (which already loaded above).
  const currentUserId = getSessionUserId();
  const [assesseeResult, dcbResult] = await Promise.all([
    getAssessee(writeOff.assesseeId),
    getDcb(writeOff.assesseeId),
  ]);
  const assessee = assesseeResult.data;
  const dcb = dcbResult.data;
  const balanceMinor = dcb ? dcb.balance : null;
  const afterMinor =
    balanceMinor !== null
      ? (BigInt(balanceMinor) - BigInt(writeOff.amountMinor)).toString()
      : null;
  const assesseeName = assessee?.ownerName ?? null;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Decide Write-off"
        subtitle="Approve or reject a pending write-off. The deciding officer must differ from the officer who raised it."
        back="/revenue/write-offs"
      />

      <Card title="Write-off" padding>
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
          <dd className="mono" style={{ margin: 0 }}>{writeOff.id}</dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Assessee</dt>
          <dd style={{ margin: 0 }}>
            {assesseeName ? (
              <>
                {assesseeName}{" "}
                <span className="mono" style={{ color: "var(--ink2)" }}>({assessee?.identifierNo})</span>
              </>
            ) : (
              <span className="mono">{writeOff.assesseeId || "—"}</span>
            )}
          </dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Demand</dt>
          <dd style={{ margin: 0 }}>
            {writeOff.financialYear ? (
              <>FY {writeOff.financialYear}</>
            ) : (
              <span style={{ color: "var(--ink2)" }}>Against the assessee (no specific demand)</span>
            )}
          </dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Outstanding arrears</dt>
          <dd style={{ margin: 0 }}>
            {formatMoney(balanceMinor)}{" "}
            <span style={{ color: "var(--ink2)", fontSize: 12 }}>(at time of viewing)</span>
          </dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Write-off amount</dt>
          <dd style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{formatMoney(writeOff.amountMinor)}</dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Balance after write-off</dt>
          <dd style={{ margin: 0 }}>{formatMoney(afterMinor)}</dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Reason</dt>
          <dd style={{ margin: 0 }}>{writeOff.reason || "—"}</dd>
          <dt style={{ fontWeight: 600, color: "var(--ink2)" }}>Status</dt>
          <dd style={{ margin: 0 }}>
            <StatusPill status={writeOff.status} label={writeOff.status} />
          </dd>
        </dl>
        {balanceMinor !== null && BigInt(writeOff.amountMinor) > BigInt(balanceMinor) && (
          <p role="alert" style={{ margin: "0 0 12px", fontSize: 13, color: "var(--bad)" }}>
            This write-off exceeds the outstanding arrears shown above. Confirm the figures before approving.
          </p>
        )}
        <WriteOffDecideForm
          writeOffId={writeOffId}
          writeOff={writeOff}
          currentUserId={currentUserId}
          assesseeName={assesseeName}
        />
      </Card>
    </div>
  );
}
