import { PageHeader, EmptyState, StatGrid, StatCard, RefreshErrorState } from "@/app/_components/ds";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { verifyCertificate } from "../../_data";

type Search = { [k: string]: string | string[] | undefined };

/**
 * GAP-LEARNING-ASSESSMENTS-VERIFY-01: no longer renders raw employeeId /
 *   assessmentId UUIDs — backend now omits employeeId for non-privileged
 *   callers (DPDP). When employeeId IS returned, it is still a UUID; for now
 *   show it only with a label, not as a primary display element.
 * GAP-LEARNING-ASSESSMENTS-VERIFY-02: differentiates 404, malformed token
 *   (client-side length check), and service errors — each gets its own
 *   honest message rather than the single DataSourceBadge for all.
 * GAP-LEARNING-ASSESSMENTS-VERIFY-04: dates use formatIndianDate for
 *   consistency; status uses StatusPill instead of raw string.
 */
export default async function Page({ searchParams }: { searchParams?: Search }) {
  const token = typeof searchParams?.token === "string" ? searchParams.token.trim() : "";

  // Client-side length check before calling (VERIFY-02: format error)
  const tokenTooShort = token.length > 0 && token.length < 8;
  const tokenTooLong = token.length > 64;
  const tokenInvalid = tokenTooShort || tokenTooLong;

  const result = token && !tokenInvalid ? await verifyCertificate(token) : null;
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
            style={{ flex: 1, minWidth: 240, padding: "8px 12px", border: "1px solid var(--line, #d1d5db)", borderRadius: 8 }}
          />
          <button className="btn" type="submit">Verify</button>
        </form>
      </div>

      {/* VERIFY-02: differentiated error states */}
      {token && tokenInvalid && (
        <EmptyState icon="⚠️" title="Invalid token format" message="A verification token must be between 8 and 64 characters." />
      )}

      {token && !tokenInvalid && result?.source === "error" && result.status === 404 && (
        <EmptyState icon="❌" title="Certificate not found" message="No certificate matches that verification token. Check the token and try again." />
      )}

      {token && !tokenInvalid && result?.source === "error" && result.status !== 404 && (
        <RefreshErrorState error={toHumanError("load", { area: "certificate verification" })} />
      )}

      {token && !tokenInvalid && !cert && result?.source !== "error" && (
        <EmptyState icon="❌" title="Certificate not found" message="No certificate matches that verification token." />
      )}

      {cert && (
        <>
          <StatGrid>
            <StatCard icon="🏅" iconBg="var(--panel)" label="Certificate No." value={cert.certificateNo} />
            <StatCard
              icon={cert.status === "active" ? "✅" : cert.status === "expired" ? "⌛" : "🚫"}
              iconBg={cert.status === "active" ? "var(--goodbg, #ecfdf5)" : "var(--badbg, #fef2f2)"}
              label="Status"
              value={humanizeStatus(cert.status)}
            />
            <StatCard icon="📅" iconBg="var(--panel)" label="Issued" value={formatIndianDate(cert.issuedAt)} />
            <StatCard icon="⏳" iconBg="var(--panel)" label="Valid until" value={cert.validUntil ? formatIndianDate(cert.validUntil) : "No expiry"} />
          </StatGrid>
          {cert.employeeId && (
            <div className="card">
              <div className="card-h"><h3>Details</h3></div>
              <div style={{ padding: 16 }}>
                <p><strong>Employee ref:</strong> {cert.employeeId}</p>
                <p><strong>Assessment ref:</strong> {cert.assessmentId}</p>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
