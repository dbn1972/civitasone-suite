import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, StatCard } from "@/app/_components/ds";
import { fetchJson } from "@/app/_data/apiClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { ApprovalFinalizeButton } from "../ApprovalFinalizeButton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TsRaw = {
  id: string;
  workId: string | null;
  tsNumber: string | null;
  tsDate: string | null;
  tsAuthorityId: string | null;
  tsAmountMinor: string | null;
  sanctionType: string | null;
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

function pickArray(payload: unknown): unknown[] {
  if (isRecord(payload) && "data" in payload) {
    const d = (payload as { data: unknown }).data;
    return Array.isArray(d) ? d : [];
  }
  return Array.isArray(payload) ? payload : [];
}

function mapRawTs(r: unknown): TsRaw | null {
  if (!isRecord(r) || typeof r.id !== "string") return null;
  return {
    id: r.id,
    workId: typeof r.workId === "string" ? r.workId : null,
    tsNumber: typeof r.tsNumber === "string" ? r.tsNumber : null,
    tsDate: typeof r.tsDate === "string" ? r.tsDate : null,
    tsAuthorityId: typeof r.tsAuthorityId === "string" ? r.tsAuthorityId : null,
    tsAmountMinor: typeof r.tsAmountMinor === "string" ? r.tsAmountMinor : null,
    sanctionType: typeof r.sanctionType === "string" ? r.sanctionType : null,
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

export default async function TsDetailPage({
  params,
}: {
  params: { id: string };
}) {
  // No GET-by-ID endpoint — fetch list and filter (capped at 100 records)
  const result = await fetchJson<unknown, TsRaw[]>(
    "/api/v1/works/approvals/ts?pageSize=100",
    [],
    {
      telemetryKey: "works.approvals.ts.detail",
      mapResponse: (p) =>
        pickArray(p)
          .map(mapRawTs)
          .filter((r): r is TsRaw => r !== null),
    },
  );

  const ts = result.data.find((r) => r.id === params.id);
  if (!ts) notFound();

  const detailRows: Array<[string, string]> = [
    ["TS Number", ts.tsNumber ?? "—"],
    ["Sanction Type", humanize(ts.sanctionType)],
    ["Work ID", ts.workId?.slice(0, 8) + "…" ?? "—"],
    ["TS Authority", ts.tsAuthorityId?.slice(0, 8) + "…" ?? "—"],
    ["Date", formatIndianDate(ts.tsDate)],
    ["Created", formatIndianDate(ts.createdAt)],
    ["Remarks", ts.remarks ?? "—"],
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={ts.tsNumber ?? `TS ${params.id.slice(0, 8)}…`}
        subtitle="Technical Sanction"
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
          label="TS Amount"
          value={formatMoney(ts.tsAmountMinor ?? "0")}
        />
        <StatCard
          icon="📑"
          iconBg="#eff6ff"
          label="Status"
          value={humanize(ts.status)}
        />
        <StatCard
          icon="🗂"
          iconBg="#fef3c7"
          label="Sanction Type"
          value={humanize(ts.sanctionType)}
        />
      </div>

      <Card title="Sanction Details">
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
        <ApprovalFinalizeButton id={ts.id} type="ts" status={ts.status} />
      </div>
    </main>
  );
}
