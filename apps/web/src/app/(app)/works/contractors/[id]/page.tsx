import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Card, DataTable, LoadErrorState, RefreshErrorState } from "@/app/_components/ds";
import { Masked, maskPan } from "@/app/_components/ds/Masked";
import { RevealableValue } from "@/app/_components/ds/RevealableValue";
import { StatusTimeline } from "@/app/_components/ds/designer/StatusTimeline";
import { fetchJson } from "@/app/_data/apiClient";
import { formatIndianDate } from "@/lib/formatters";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { CONTRACTOR_RATE_ROLES, canRevealContractorPii } from "@/lib/works/roles";
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
  ratedByName?: string;
  note?: string;
};

type RatingDisplayRow = {
  id: string;
  rating: string;
  ratedAt: string;
  ratedBy: string;
  note: string;
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
  return rows.flatMap((r, index) => {
    if (!isRecord(r)) return [];
    const rr = r as Record<string, unknown>;
    return [
      {
        // GAP-WORKS-CONTRACTORS-DETAIL-03: never Math.random() a key (it churns
        // on every render and breaks list reconciliation); fall back to the row
        // index when the API omits an id.
        id: typeof rr.id === "string" ? rr.id : `rating-${index}`,
        rating: Number(rr.rating ?? 0),
        ratedAt: String(rr.ratedAt ?? ""),
        ratedBy: rr.ratedBy ? String(rr.ratedBy) : undefined,
        ratedByName: rr.ratedByName ? String(rr.ratedByName) : undefined,
        note: rr.note ? String(rr.note) : undefined,
      },
    ];
  });
}

/**
 * GAP-WORKS-CONTRACTORS-DETAIL-05: floor to whole filled stars so the glyph
 * row never shows MORE stars than the printed decimal (4.5 -> 4 filled, never
 * 5). The precise value is printed numerically beside it.
 */
function starDisplay(rating: number): string {
  const filled = Math.min(5, Math.max(0, Math.floor(rating)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

export default async function ContractorDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const roles = getSessionRoles();
  const canRate = roles.some((r) => CONTRACTOR_RATE_ROLES.includes(r));
  const canRevealPii = canRevealContractorPii(roles);
  const viewerId = getSessionUserId();

  const [contractorResult, ratingResult] = await Promise.all([
    fetchJson<unknown, ContractorDetail>(
      `/api/v1/works/contractors/${params.id}`,
      EMPTY,
      {
        telemetryKey: "works.contractors.detail",
        mapResponse: (p) => {
          if (!isRecord(p)) return null as unknown as ContractorDetail;
          return (
            ((p as { data?: ContractorDetail }).data ??
              (null as unknown as ContractorDetail))
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

  const { data: contractor, source, status, errorMessage } = contractorResult;
  const { data: ratingHistory, source: ratingSource } = ratingResult;

  // GAP-WORKS-CONTRACTORS-DETAIL-01 (FAILMASK): a real missing id (API 404)
  // is a genuine not-found; every OTHER failure (403/5xx/network/invalid
  // payload) must render an honest, retryable error state — NOT a 404 that
  // tells the user the contractor "does not exist".
  if (source === "error") {
    if (status === 404) return notFound();
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Contractor" back="/works/contractors" backLabel="Contractors" />
        <LoadErrorState
          result={{ status, errorMessage }}
          area="contractor"
          backHref="/works/contractors"
          backLabel="Contractors"
        />
      </div>
    );
  }
  if (!contractor.id) return notFound();

  // KPI grid: identifiers (PAN/GST/Phone/Email) are shown ONCE in Contact
  // Details below (GAP-WORKS-CONTRACTORS-DETAIL-02), not duplicated here.
  const kpiItems: Array<{ label: string; value: string }> = [
    { label: "Status", value: contractor.active ? "Active" : "Inactive" },
    { label: "Reg. No.", value: String(contractor.registrationNo ?? "—") },
    { label: "Registered Since", value: formatIndianDate(contractor.createdAt) },
    { label: "Reviews", value: String(contractor.ratingCount) },
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

  const ratingDisplayRows: RatingDisplayRow[] = ratingHistory.map((r, i) => ({
    id: r.id || `rating-${i}`,
    ratedAt: r.ratedAt ? new Date(r.ratedAt).toLocaleDateString("en-IN") : "—",
    rating: `${r.rating} / 5`,
    // GAP-WORKS-CONTRACTORS-DETAIL-03: show a resolved rater NAME when the
    // backend supplies one; never an opaque 8-char UUID slice.
    ratedBy: r.ratedByName && r.ratedByName.trim() ? r.ratedByName : "—",
    note: r.note && r.note.trim() ? r.note : "—",
  }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={contractor.name}
        subtitle={`Reg. No. ${String(contractor.registrationNo ?? "—")}`}
        back="/works/contractors"
        backLabel="Contractors"
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

      {/* Contact Details card — PII masked by default (DPDP); PAN has an
          audited reveal for authorised roles. */}
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
          <div>
            <dt style={dtStyle}>Address</dt>
            <dd style={{ margin: 0, fontWeight: 500 }}>{String(contractor.address ?? "—")}</dd>
          </div>
          <div>
            <dt style={dtStyle}>Email</dt>
            <dd style={{ margin: 0, fontWeight: 500 }}>
              <Masked value={contractor.email} kind="email" fallback="—" ariaLabel="Contractor email (masked)" />
            </dd>
          </div>
          <div>
            <dt style={dtStyle}>Phone</dt>
            <dd style={{ margin: 0, fontWeight: 500 }}>
              <Masked value={contractor.phone} kind="phone" fallback="—" ariaLabel="Contractor phone (masked)" />
            </dd>
          </div>
          <div>
            <dt style={dtStyle}>PAN</dt>
            <dd style={{ margin: 0, fontWeight: 500 }}>
              {contractor.pan ? (
                <RevealableValue
                  maskedText={maskPan(contractor.pan)}
                  revealPath={`v1/works/contractors/${params.id}/reveal-pan`}
                  pick={(json) => (json as { data?: { value?: string | null } })?.data?.value}
                  canReveal={canRevealPii}
                  label="PAN"
                  fallback="—"
                />
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt style={dtStyle}>GST</dt>
            <dd style={{ margin: 0, fontWeight: 500 }}>{String(contractor.gst ?? "—")}</dd>
          </div>
          <div>
            <dt style={dtStyle}>Active</dt>
            <dd style={{ margin: 0, fontWeight: 500 }}>{contractor.active ? "Yes" : "No"}</dd>
          </div>
        </dl>
      </Card>

      {/* Rate Contractor card — only rendered for roles that can rate
          (GAP-WORKS-CONTRACTORS-DETAIL-05). */}
      {canRate && (
        <Card title="Rate Contractor">
          <div style={{ padding: "16px" }}>
            <ContractorRatingForm
              contractorId={params.id}
              currentRating={contractor.performanceRating ?? 0}
              ratingCount={contractor.ratingCount}
              canRate={canRate}
              lastRatedAt={ratingHistory[0]?.ratedAt ?? null}
              lastRatedBy={ratingHistory[0]?.ratedBy ?? null}
              viewerId={viewerId}
            />
          </div>
        </Card>
      )}

      {/* Rating History card */}
      <Card title={`Rating History (${ratingHistory.length})`}>
        {ratingSource === "error" ? (
          // GAP-WORKS-CONTRACTORS-DETAIL-01: a failed history fetch must not
          // masquerade as "No ratings recorded yet."
          <div style={{ padding: "12px 0" }}>
            <RefreshErrorState
              error={{
                what: "Couldn't load the rating history.",
                next: "This is usually temporary — try again.",
                actions: ["retry"],
              }}
            />
          </div>
        ) : ratingHistory.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--muted)", padding: "12px 0" }}>
            No ratings recorded yet.
          </p>
        ) : (
          <DataTable<RatingDisplayRow>
            columns={[
              { key: "ratedAt", label: "Date" },
              { key: "rating", label: "Rating (1–5)" },
              { key: "ratedBy", label: "Rated By" },
              { key: "note", label: "Comment" },
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
          contractor={
            canRevealPii
              ? {
                  id: contractor.id,
                  name: contractor.name,
                  registrationNo: contractor.registrationNo ?? null,
                  pan: contractor.pan ?? null,
                  gst: contractor.gst ?? null,
                  email: contractor.email ?? null,
                  phone: contractor.phone ?? null,
                  address: contractor.address ?? null,
                }
              : {
                  // GAP-WORKS-CONTRACTORS-DETAIL-02 step 4: a non-editor's RSC
                  // payload must not carry the clear PAN/phone/email. The edit
                  // toggle renders null for them anyway (canEdit=false).
                  id: contractor.id,
                  name: contractor.name,
                  registrationNo: contractor.registrationNo ?? null,
                  pan: null,
                  gst: null,
                  email: null,
                  phone: null,
                  address: null,
                }
          }
          roles={roles}
        />
      </div>
    </div>
  );
}

const dtStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--muted)",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 2,
};
