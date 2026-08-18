import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { ProposalActions } from "./ProposalActions";
import { ProposalExtActions } from "./ProposalExtActions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WorkProposal = {
  id: string;
  workNumber: string;
  category: string;
  description: string;
  estimatedCostMinor: string;
  status: string;
  district: string;
  taluka: string;
  village: string;
  habitation: string;
  sector: string;
  remarks: string;
  daoFinalizedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  workTypeId: string | null;
  chargedOrVoted: string;
  planOrNonPlan: string;
  budgetYear: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function humanize(s: string | null | undefined): string {
  if (!s || s === "—") return "—";
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapProposal(payload: unknown): WorkProposal | null {
  if (!isRecord(payload)) return null;

  // Unwrap envelope: API returns { data: { ... } }
  const env = payload as { data?: unknown };
  const raw: Record<string, unknown> = isRecord(env.data)
    ? (env.data as Record<string, unknown>)
    : (payload as Record<string, unknown>);

  if (typeof raw.id !== "string" || !raw.id) return null;

  return {
    id: raw.id,
    workNumber: String(raw.workNumber ?? "—"),
    category: String(raw.category ?? "—"),
    description: String(raw.description ?? "—"),
    estimatedCostMinor: String(raw.estimatedCostMinor ?? "0"),
    status: String(raw.status ?? "—"),
    district: String(raw.district ?? "—"),
    taluka: String(raw.taluka ?? "—"),
    village: String(raw.village ?? "—"),
    habitation: String(raw.habitation ?? "—"),
    sector: String(raw.sector ?? "—"),
    remarks: String(raw.remarks ?? ""),
    daoFinalizedAt: raw.daoFinalizedAt != null ? String(raw.daoFinalizedAt) : null,
    createdAt: raw.createdAt != null ? String(raw.createdAt) : null,
    updatedAt: raw.updatedAt != null ? String(raw.updatedAt) : null,
    workTypeId: raw.workTypeId != null ? String(raw.workTypeId) : null,
    chargedOrVoted: String(raw.chargedOrVoted ?? "—"),
    planOrNonPlan: String(raw.planOrNonPlan ?? "—"),
    budgetYear: String(raw.budgetYear ?? "—"),
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

async function getProposal(id: string) {
  return fetchJson<unknown, WorkProposal | null>(
    `/api/v1/works/proposals/${id}`,
    null,
    {
      telemetryKey: "works.proposal.detail",
      mapResponse: mapProposal,
    },
  );
}

// ---------------------------------------------------------------------------
// Styles (re-used to keep inline style objects DRY)
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

export default async function WorkProposalDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { data: proposal, source } = await getProposal(params.id);

  if (source === "error" || !proposal || !proposal.id) {
    notFound();
  }

  const detailRows: Array<[string, string]> = [
    ["Work Number", proposal.workNumber],
    ["Plan/Non-Plan", humanize(proposal.planOrNonPlan)],
    ["Budget Year", proposal.budgetYear],
    ["DAO Finalized At", formatIndianDate(proposal.daoFinalizedAt)],
    ["Created", formatIndianDate(proposal.createdAt)],
    ["Updated", formatIndianDate(proposal.updatedAt)],
    ["Remarks", proposal.remarks || "—"],
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={proposal.workNumber}
        subtitle={truncate(proposal.description, 80)}
        back="/works/proposals"
        backLabel="Proposals"
        actions={
          source === "error" ? <DataSourceBadge source="error" /> : undefined
        }
      />

      {/* 6 KPI tiles */}
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
          label="Estimated Cost"
          value={formatMoney(proposal.estimatedCostMinor)}
        />
        <StatCard
          icon="🗂"
          iconBg="#eff6ff"
          label="Category"
          value={humanize(proposal.category)}
        />
        <StatCard
          icon="📋"
          iconBg="#fef3c7"
          label="Status"
          value={humanize(proposal.status)}
        />
        <StatCard
          icon="🏛"
          iconBg="#f5f3ff"
          label="District"
          value={proposal.district}
        />
        <StatCard
          icon="🏘"
          iconBg="#fff7ed"
          label="Taluka"
          value={proposal.taluka}
        />
        <StatCard
          icon="🏡"
          iconBg="#f0fdf4"
          label="Village"
          value={proposal.village}
        />
      </div>

      {/* Proposal Details */}
      <Card title="Proposal Details">
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(140px, max-content) 1fr",
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

      {/* Footer action row */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 24,
          paddingBottom: 32,
        }}
      >
        <Link href="/works/proposals" className="btn ghost">
          ← All proposals
        </Link>
        <ProposalActions id={String(proposal.id ?? "")} status={String(proposal.status ?? "")} />
        <Link
          href={"/works/approvals/new?workId=" + proposal.id}
          className="btn secondary"
        >
          Create AA →
        </Link>
      </div>

      <ProposalExtActions workId={proposal.id ?? params.id} />
    </main>
  );
}
