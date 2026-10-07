import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, StatCard, LoadErrorState } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { APPROVAL_FINALIZE_ROLES } from "@/lib/auth/workRoles";
import { ApprovalFinalizeButton } from "../ApprovalFinalizeButton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AaRaw = {
  id: string;
  workId: string | null;
  aaNumber: string | null;
  aaDate: string | null;
  approvingAuthorityId: string | null;
  approvedAmountMinor: string | null;
  approvalType: string | null;
  status: string;
  remarks: string | null;
  createdAt: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function mapRawAa(r: unknown): AaRaw | null {
  if (!isRecord(r) || typeof r.id !== "string") return null;
  return {
    id: r.id,
    workId: typeof r.workId === "string" ? r.workId : null,
    aaNumber: typeof r.aaNumber === "string" ? r.aaNumber : null,
    aaDate: typeof r.aaDate === "string" ? r.aaDate : null,
    approvingAuthorityId:
      typeof r.approvingAuthorityId === "string" ? r.approvingAuthorityId : null,
    approvedAmountMinor:
      typeof r.approvedAmountMinor === "string" ? r.approvedAmountMinor : null,
    approvalType: typeof r.approvalType === "string" ? r.approvalType : null,
    status: typeof r.status === "string" ? r.status : "draft",
    remarks: typeof r.remarks === "string" ? r.remarks : null,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : null,
  };
}

function humanize(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  color: "var(--ink3)",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  alignSelf: "center",
};

const valueStyle: React.CSSProperties = {
  color: "var(--ink)",
  fontSize: 14,
  alignSelf: "center",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AaDetailPage({
  params,
}: {
  params: { id: string };
}) {
  // GET-by-id (GAP-WORKS-APPROVALS-AA-DETAIL-01): fetch the single record so a
  // record beyond the first list page is reachable. The backend returns
  // { data: <record> }; a genuinely missing id is a 404, every other failure
  // is a load error — the two must not be conflated (GAP-...-AA-DETAIL-02).
  const result = await fetchJson<unknown, AaRaw | null>(
    `/api/v1/works/approvals/aa/${params.id}`,
    null,
    {
      telemetryKey: "works.approvals.aa.detail",
      mapResponse: (p) => {
        const record = isRecord(p) && "data" in p ? (p as { data: unknown }).data : p;
        return mapRawAa(record);
      },
    },
  );

  // Only a definitive 404 means "this AA doesn't exist". Any other failure
  // (401/403/5xx/network) is a load problem — show a retryable error state
  // with a back link, never a misleading "not found".
  if (result.source === "error") {
    if (result.status === 404) notFound();
    return (
      <div className="page-main wrap">
        <PageHeader
          title="Administrative Approval"
          subtitle="Could not load this record."
          back="/works/approvals"
          backLabel="Approvals"
        />
        <LoadErrorState
          result={result}
          area="administrative approval"
          backHref="/works/approvals"
          backLabel="Approvals"
        />
      </div>
    );
  }

  const aa = result.data;
  if (!aa) notFound();

  const canFinalize = hasAnyRole(getSessionRoles(), APPROVAL_FINALIZE_ROLES);

  const detailRows: Array<[string, React.ReactNode]> = [
    ["AA Number", aa.aaNumber ?? "—"],
    ["Approval Type", humanize(aa.approvalType)],
    [
      "Work",
      aa.workId != null ? (
        <Link href={`/works/billing/${aa.workId}`} title={aa.workId}>
          {aa.workId.slice(0, 8) + "…"}
        </Link>
      ) : (
        "—"
      ),
    ],
    [
      "Approving Authority (ID)",
      aa.approvingAuthorityId != null ? (
        <span title={aa.approvingAuthorityId} style={{ fontFamily: "var(--font-mono, monospace)" }}>
          {aa.approvingAuthorityId.slice(0, 8) + "…"}
        </span>
      ) : (
        "—"
      ),
    ],
    ["Date", formatIndianDate(aa.aaDate)],
    ["Created", formatIndianDate(aa.createdAt)],
    ["Remarks", aa.remarks ?? "—"],
  ];

  return (
    <div className="page-main wrap">
      <PageHeader
        title={aa.aaNumber ?? `AA ${params.id.slice(0, 8)}…`}
        subtitle="Administrative Approval"
        back="/works/approvals"
        backLabel="Approvals"
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatCard
          icon="₹"
          iconBg="#ecfdf3"
          label="Approved Amount"
          value={formatMoney(aa.approvedAmountMinor ?? "0")}
        />
        <StatCard
          icon="📋"
          iconBg="#eff6ff"
          label="Status"
          value={humanize(aa.status)}
        />
        <StatCard
          icon="🗂"
          iconBg="#fef3c7"
          label="Approval Type"
          value={humanize(aa.approvalType)}
        />
      </div>

      <Card title="Approval Details">
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(160px, max-content) 1fr",
            columnGap: 24,
            rowGap: 12,
            padding: "16px 20px",
            margin: 0,
            borderTop: "1px solid var(--border)",
          }}
        >
          {detailRows.map(([label, value]) => (
            <Fragment key={label}>
              <dt style={labelStyle}>{label}</dt>
              <dd style={{ ...valueStyle, margin: 0 }}>{value}</dd>
            </Fragment>
          ))}
        </dl>
      </Card>

      <div style={{ display: "flex", gap: 12, marginTop: 24, paddingBottom: 32 }}>
        <Link href="/works/approvals" className="btn ghost">
          ← All approvals
        </Link>
        <ApprovalFinalizeButton id={aa.id} type="aa" status={aa.status} canFinalize={canFinalize} />
      </div>
    </div>
  );
}
