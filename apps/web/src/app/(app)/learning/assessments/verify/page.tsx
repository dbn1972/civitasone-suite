import { PageHeader, EmptyState, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { verifyCertificate } from "../../_data";

type Search = { [k: string]: string | string[] | undefined };

export default async function Page({ searchParams }: { searchParams?: Search }) {
  const token = typeof searchParams?.token === "string" ? searchParams.token.trim() : "";
  const result = token ? await verifyCertificate(token) : null;
  const cert = result?.data ?? null;

  return (
    <>
      <PageHeader title="Verify Certificate" subtitle="Enter a certificate's verification token to check its authenticity and status." back="/learning/assessments" />
      <div className="card">
        <div className="card-h"><h3>Verification</h3></div>
        <form method="get" style={{ display: "flex", gap: 12, padding: 16, flexWrap: "wrap" }}>
          <input
            name="token"
            defaultValue={token}
            placeholder="Verification token"
            aria-label="Verification token"
            style={{ flex: 1, minWidth: 240, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8 }}
          />
          <button className="btn" type="submit">Verify</button>
        </form>
      </div>

      {token && result?.source === "error" && <DataSourceBadge source="error" />}

      {token && !cert && result?.source !== "error" && (
        <EmptyState icon="❌" title="Certificate not found" message="No certificate matches that verification token." />
      )}

      {cert && (
        <>
          <StatGrid>
            <StatCard icon="🏅" iconBg="#eef2ff" label="Certificate No." value={cert.certificateNo} />
            <StatCard
              icon={cert.status === "active" ? "✅" : cert.status === "expired" ? "⌛" : "🚫"}
              iconBg={cert.status === "active" ? "#ecfdf5" : "#fef2f2"}
              label="Status"
              value={cert.status}
            />
            <StatCard icon="📅" iconBg="#fffbeb" label="Issued" value={new Date(cert.issuedAt).toLocaleDateString("en-IN")} />
            <StatCard icon="⏳" iconBg="#fef2ff" label="Valid until" value={cert.validUntil ? new Date(cert.validUntil).toLocaleDateString("en-IN") : "No expiry"} />
          </StatGrid>
          <div className="card">
            <div className="card-h"><h3>Details</h3></div>
            <div style={{ padding: 16 }}>
              <p><strong>Employee:</strong> {cert.employeeId}</p>
              <p><strong>Assessment:</strong> {cert.assessmentId}</p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
