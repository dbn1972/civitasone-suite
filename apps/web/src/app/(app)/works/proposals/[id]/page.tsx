import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, StatCard, RefreshErrorState } from "@/app/_components/ds";
import { StatusTimeline } from "@/app/_components/ds/designer/StatusTimeline";
import type { StatusTimelineStep } from "@/app/_components/ds/designer/StatusTimeline";
import { fetchJson } from "@/app/_data/apiClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { ProposalActions } from "./ProposalActions";
import { ProposalExtActions } from "./ProposalExtActions";
import { ProposalEditToggle } from "./ProposalEditToggle";

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
// Timeline
// ---------------------------------------------------------------------------

// GAP-WORKS-PROPOSALS-DETAIL-02 (WIRING): the timeline previously advertised
// "Submitted", "TS Eligible" and "AA Issued" steps the backend never sets —
// work_proposals.status is only ever "draft" (on create) or "dao_finalized"
// (on DAO finalize); see services/works-service/src/modules/proposal/
// consumer.ts, the sole writer of that column. That made a draft show
// "Submitted" as the current step and a finalized proposal show "TS Eligible"
// as a dead "current" step with no action to advance it. The timeline now
// shows only the two real, backend-driven lifecycle states. (AA/TS live as
// separate approval records under /works/approvals, reached via "Create AA".)
function buildTimelineSteps(proposal: WorkProposal): StatusTimelineStep[] {
  const isFinalized = proposal.status === "dao_finalized";
  function fmtDate(d: string | null): string | undefined {
    const s = formatIndianDate(d);
    return s !== "—" ? s : undefined;
  }
  return [
    {
      id: "created",
      label: "Proposal Created",
      // Known statuses => created is done. An unknown/unexpected status must
      // not leave "created" marked current with no way to advance.
      state: "done",
      date: fmtDate(proposal.createdAt),
    },
    {
      id: "dao_finalized",
      label: "DAO Finalized",
      state: isFinalized ? "done" : "current",
      date: fmtDate(proposal.daoFinalizedAt),
    },
  ];
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
  const { data: proposal, source, status } = await getProposal(params.id);

  // GAP-WORKS-PROPOSALS-DETAIL-01 (FAILMASK): a failed fetch used to call
  // notFound() unconditionally, so a 500/network/401 read as "this proposal
  // does not exist". Only a real 404 is "not found"; any other failure shows
  // an honest, retryable error state instead of the 404 page.
  if (status === 404) {
    notFound();
  }
  if (source === "error" || !proposal || !proposal.id) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Work proposal" back="/works/proposals" backLabel="Proposals" />
        <RefreshErrorState
          error={toHumanError("load", { area: "work proposal" })}
          backHref="/works/proposals"
          source={{ status, area: "work proposal" }}
        />
      </div>
    );
  }

  const roles = getSessionRoles();

  const detailRows: Array<[string, string]> = [
    ["Work Number", proposal.workNumber],
    ["Plan/Non-Plan", humanize(proposal.planOrNonPlan)],
    ["Budget Year", proposal.budgetYear],
    ["Charged / Voted", humanize(proposal.chargedOrVoted)],
    ["Habitation", proposal.habitation || "—"],
    ["Sector", humanize(proposal.sector)],
    ["DAO Finalized At", formatIndianDate(proposal.daoFinalizedAt)],
    ["Created", formatIndianDate(proposal.createdAt)],
    ["Updated", formatIndianDate(proposal.updatedAt)],
    ["Remarks", proposal.remarks || "—"],
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={proposal.workNumber}
        subtitle={truncate(proposal.description, 80)}
        back="/works/proposals"
        backLabel="Proposals"

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

      {/* Progress timeline */}
      <Card title="Progress">
        <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)" }}>
          <StatusTimeline steps={buildTimelineSteps(proposal)} />
        </div>
      </Card>

      {/* Footer action row */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginTop: 24,
          paddingBottom: 32,
        }}
      >
        <Link href="/works/proposals" className="btn ghost">
          ← All proposals
        </Link>
        <ProposalActions id={String(proposal.id ?? "")} status={String(proposal.status ?? "")} roles={roles} />
        <ProposalEditToggle
          proposal={{
            id: String(proposal.id ?? ""),
            status: String(proposal.status ?? ""),
            description: String(proposal.description ?? ""),
            estimatedCostMinor: String(proposal.estimatedCostMinor ?? "0"),
            district: proposal.district ?? null,
            taluka: proposal.taluka ?? null,
            village: proposal.village ?? null,
            remarks: proposal.remarks ?? null,
          }}
          roles={roles}
        />
        <Link
          href={"/works/approvals/new?workId=" + proposal.id}
          className="btn secondary"
        >
          Create AA →
        </Link>
      </div>

      <ProposalExtActions
        workId={proposal.id ?? params.id}
        roles={roles}
        workNumber={proposal.workNumber}
        estimatedCostMinor={proposal.estimatedCostMinor}
      />
    </div>
  );
}
