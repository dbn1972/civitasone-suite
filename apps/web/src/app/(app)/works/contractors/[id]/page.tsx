import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { fetchJson } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { ContractorRatingForm } from "./ContractorRatingForm";

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

function starDisplay(rating: number): string {
  const filled = Math.min(5, Math.max(0, Math.round(rating)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

export default async function ContractorDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { data: contractor, source } = await fetchJson<unknown, ContractorDetail>(
    `/api/v1/works/contractors/${params.id}`,
    EMPTY,
    {
      telemetryKey: "works.contractors.detail",
      mapResponse: (p) => {
        if (!p || typeof p !== "object") return null as unknown as ContractorDetail;
        return (p as { data?: ContractorDetail }).data ?? (null as unknown as ContractorDetail);
      },
    }
  );

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
      </div>
    </main>
  );
}
