import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DataTable } from "@/app/_components/ds";
import { StatusTimeline } from "@/app/_components/ds/designer/StatusTimeline";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { ContractorRatingForm } from "./ContractorRatingForm";
import { ContractorEditToggle } from "./ContractorEditToggle";

type ContractorDetail = {
  id: string;
  name: string;
  registrationNo: string;
  pan: string;
  gst: string;
  email: string;
  phone: string;
  address: string;
  active: boolean;
  performanceRating: number | null;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
};

type RatingHistoryRow = {
  id: string;
  rating: number;
  ratedAt: string;
  ratedBy?: string;
};

type RatingDisplayRow = {
  id: string;
  rating: string;
  ratedAt: string;
  ratedBy: string;
};

const EMPTY: ContractorDetail = {
  id: "",
  name: "",
  registrationNo: "",
  pan: "",
  gst: "",
  email: "",
  phone: "",
  address: "",
  active: false,
  performanceRating: null,
  ratingCount: 0,
  createdAt: "",
  updatedAt: "",
};

const CONTRACTOR_RATE_ROLES = [
  "works_admin",
  "works_operator",
  "super_admin",
  "dao",
  "do",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mapRatingHistory(payload: unknown): RatingHistoryRow[] | null {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: unknown[] }).data
    : null;
  if (!rows) return null;
  return rows.flatMap((r) => {
    if (!isRecord(r)) return [];
    return [
      {
        id: String((r as { id?: unknown }).id ?? Math.random()),
        rating: Number((r as { rating?: unknown }).rating ?? 0),
        ratedAt: String((r as { ratedAt?: unknown }).ratedAt ?? ""),
        ratedBy: (r as { ratedBy?: unknown }).ratedBy
          ? String((r as { ratedBy?: unknown }).ratedBy)
          : undefined,
      },
    ];
  });
}

function starDisplay(rating: number): string {
  const filled = Math.min(5, Math.max(0, Math.round(rating)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

export default async function ContractorDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const roles = getSessionRoles();
  const canRate = roles.some((r) => CONTRACTOR_RATE_ROLES.includes(r));

  const [{ data: contractor, source }, { data: ratingHistory }] =
    await Promise.all([
      fetchJson<unknown, ContractorDetail>(
        `/api/v1/works/contractors/${params.id}`,
        EMPTY,
        {
          telemetryKey: "works.contractors.detail",
          mapResponse: (p) => {
            if (!p || typeof p !== "object")
              return null as unknown as ContractorDetail;
            return (
              (p as { data?: ContractorDetail }).data ??
              (null as unknown as ContractorDetail)
            );
          },
        }
      ),
      fetchJson<unknown, RatingHistoryRow[]>(
        `/api/v1/works/contractors/${params.id}/rating-history`,
        [],
        {
          telemetryKey: "works.contractor.rating-history",
          mapResponse: mapRatingHistory,
        }
      ),
    ]);

  const hasApiError = source === "error";
  if (source === "error" || !contractor.id) return notFound();

  const kpiItems: Array<{ label: string; value: string }> = [
    { label: "PAN", value: String(contractor.pan ?? "—") },
    { label: "GST", value: String(contractor.gst ?? "—") },
    { label: "Phone", value: String(contractor.phone ?? "—") },
    { label: "Email", value: String(contractor.email ?? "—") },
    { label: "Status", value: contractor.active ? "Active" : "Inactive" },
    { label: "Registered Since", value: formatIndianDate(contractor.createdAt) },
  ];

  const contactFields: Array<{ term: string; value: string }> = [
    { term: "Address", value: String(contractor.address ?? "—") },
    { term: "Email", value: String(contractor.email ?? "—") },
    { term: "Phone", value: String(contractor.phone ?? "—") },
    { term: "PAN", value: String(contractor.pan ?? "—") },
    { term: "GST", value: String(contractor.gst ?? "—") },
    { term: "Active", value: contractor.active ? "Yes" : "No" },
  ];

  const contractorTimelineSteps = [
    {
      id: "registered",
      label: "Registered",
      state: "done" as const,
      date: contractor.createdAt,
    },
    {
      id: "active",
      label: contractor.active !== false ? "Active" : "Inactive",
      state:
        contractor.active !== false ? ("current" as const) : ("done" as const),
    },
  ];

  const ratingDisplayRows: RatingDisplayRow[] = ratingHistory.map((r) => ({
    id: r.id,
    ratedAt: r.ratedAt ? new Date(r.ratedAt).toLocaleDateString("en-IN") : "—",
    rating: `${r.rating} / 5`,
    ratedBy: r.ratedBy?.slice(0, 8) ?? "—",
  }));

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={contractor.name}
        subtitle={`Reg. No. ${String(contractor.registrationNo ?? "—")}`}
        back="/works/contractors"
        backLabel="Contractors"
        actions={hasApiError ? <DataSourceBadge source="error" /> : undefined}
      />

      {/* Rating banner */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 18px",
          borderRadius: 12,
          background: "var(--surface2, #f8fafc)",
          border: "1px solid var(--line)",
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        {contractor.performanceRating != null ? (
          <>
            <span
              aria-label={`Rating: ${contractor.performanceRating.toFixed(1)} out of 5`}
              style={{ fontSize: 24, letterSpacing: 3, color: "#f59e0b" }}
            >
              {starDisplay(contractor.performanceRating)}
            </span>
            <strong style={{ fontSize: 18 }}>
              {contractor.performanceRating.toFixed(1)} / 5.0
            </strong>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              ({contractor.ratingCount} review
              {contractor.ratingCount !== 1 ? "s" : ""})
            </span>
          </>
        ) : (
          <span style={{ color: "var(--muted)", fontStyle: "italic" }}>
            Not yet rated
          </span>
        )}
      </div>

      {/* KPI grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {kpiItems.map(({ label, value }) => (
          <div key={label} className="card" style={{ padding: "12px 16px" }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 4,
              }}
            >
              {label}
            </div>
            <div
              style={{ fontWeight: 600, fontSize: 14, wordBreak: "break-all" }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Contact Details card */}
      <Card title="Contact Details">
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "12px 24px",
            padding: "16px",
            margin: 0,
          }}
        >
          {contactFields.map(({ term, value }) => (
            <div key={term}>
              <dt
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: 2,
                }}
              >
                {term}
              </dt>
              <dd style={{ margin: 0, fontWeight: 500 }}>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* Rate Contractor card */}
      <Card title="Rate Contractor">
        <div style={{ padding: "16px" }}>
          <ContractorRatingForm
            contractorId={params.id}
            currentRating={contractor.performanceRating ?? 0}
            ratingCount={contractor.ratingCount}
            canRate={canRate}
          />
        </div>
      </Card>

      {/* Rating History card */}
      <Card title={`Rating History (${ratingHistory.length})`}>
        {ratingHistory.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)", padding: "12px 0" }}>
            No ratings recorded yet.
          </p>
        ) : (
          <DataTable<RatingDisplayRow>
            columns={[
              { key: "ratedAt", label: "Date" },
              { key: "rating", label: "Rating (1–5)" },
              { key: "ratedBy", label: "Rated By" },
            ]}
            rows={ratingDisplayRows}
            pageSize={10}
            emptyIcon="⭐"
            emptyTitle="No ratings yet"
            emptyMessage="Ratings will appear here after the contractor is evaluated."
          />
        )}
      </Card>

      {/* Contractor Status card */}
      <Card title="Contractor Status">
        <div style={{ padding: "16px" }}>
          <StatusTimeline
            steps={contractorTimelineSteps}
            aria-label="Contractor lifecycle"
          />
        </div>
      </Card>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginTop: 24,
          flexWrap: "wrap",
        }}
      >
        <Link href="/works/contractors" className="btn ghost">
          ← All contractors
        </Link>
        <ContractorEditToggle
          contractor={{
            id: contractor.id,
            name: contractor.name,
            registrationNo: contractor.registrationNo ?? null,
            pan: contractor.pan ?? null,
            gst: contractor.gst ?? null,
            email: contractor.email ?? null,
            phone: contractor.phone ?? null,
            address: contractor.address ?? null,
          }}
          roles={roles}
        />
      </div>
    </main>
  );
}
