import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { CertificationCard } from "./_components/CertificationCard";

type Row = {
  id: string;
  employee: string;
  department: string;
  certification: string;
  issuingBody: string;
  issuedDate: string;
  expiryDate: string | null;
  status: string;
} & Record<string, unknown>;

// Mandatory certification keywords for government HRMS
const MANDATORY_KEYWORDS = ["service rules","conduct","dopt","rti","data protection","cyber security"];

function isMandatory(row: Row): boolean {
  const name = (row.certification ?? "").toLowerCase();
  return MANDATORY_KEYWORDS.some((kw) => name.includes(kw));
}

function deriveCardStatus(row: Row): "valid" | "expiring_soon" | "expired" {
  if (!row.expiryDate) return "valid";
  const days = Math.ceil((new Date(row.expiryDate).getTime() - Date.now()) / 86400000);
  if (days < 0)   return "expired";
  if (days <= 30) return "expiring_soon";
  return "valid";
}

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/certifications", [], {
    telemetryKey: "hr.certifications",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function CertificationsPage() {
  const { data: items, source } = await getData();

  const valid        = items.filter((i) => deriveCardStatus(i) === "valid").length;
  const expiringSoon = items.filter((i) => deriveCardStatus(i) === "expiring_soon").length;
  const expired      = items.filter((i) => deriveCardStatus(i) === "expired").length;
  const depts        = new Set(items.map((i) => i.department)).size;

  // Sort: expired first, then expiring_soon, then valid
  const sorted = [...items].sort((a, b) => {
    const order = { expired: 0, expiring_soon: 1, valid: 2 };
    return (order[deriveCardStatus(a)] ?? 2) - (order[deriveCardStatus(b)] ?? 2);
  });

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Certifications"
        subtitle="Employee professional certifications, training completions, and validity tracking."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🏅" iconBg="#e6f0ff" label="Total Certificates" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Valid"              value={valid} />
        <StatCard icon="⚠️" iconBg="#fff7e6" label="Expiring Soon"      value={expiringSoon} />
        <StatCard icon="🚫" iconBg="#fff1f0" label="Expired"            value={expired} />
      </StatGrid>

      {/* Alert banner */}
      {(expiringSoon > 0 || expired > 0) && (
        <div
          style={{
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: 8,
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            color: "#92400e",
          }}
        >
          <span style={{ fontSize: 16 }}>⚠</span>
          <span>
            <strong>{expired} expired</strong> and{" "}
            <strong>{expiringSoon} expiring within 30 days</strong> — action required.
          </span>
        </div>
      )}

      <Card title="Certifications Register">
        {sorted.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
            <p style={{ fontSize: 32, margin: "0 0 8px" }}>🏅</p>
            <p style={{ fontWeight: 600, color: "#475569", margin: 0 }}>No certifications recorded yet</p>
            <p style={{ fontSize: 13, margin: "4px 0 0" }}>
              Certifications appear here once employees complete external courses or government training programmes.
            </p>
          </div>
        ) : (
          <div
            style={{
              padding: "12px 16px 16px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 14,
            }}
          >
            {sorted.map((row) => (
              <CertificationCard
                key={row.id}
                id={row.id}
                certificationName={row.certification}
                issuingBody={row.issuingBody}
                obtainedDate={row.issuedDate}
                expiryDate={row.expiryDate}
                isMandatory={isMandatory(row)}
                status={deriveCardStatus(row)}
              />
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}
