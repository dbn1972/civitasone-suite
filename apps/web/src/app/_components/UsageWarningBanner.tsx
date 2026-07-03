"use client";

/**
 * Global usage warning banner — shows at the top of the page when
 * any resource is >90% of its quota limit.
 *
 * Usage: Place in root layout or dashboard layout.
 * In production, this would fetch from GET /v1/tenant/usage.
 */

interface UsageAlert {
  resource: string;
  label: string;
  percent: number;
  limit: number;
  used: number;
}

interface UsageWarningBannerProps {
  alerts: UsageAlert[];
}

export function UsageWarningBanner({ alerts }: UsageWarningBannerProps) {
  if (alerts.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: 8,
        padding: "12px 20px",
        marginBottom: 16,
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <span style={{ fontSize: 20 }} aria-hidden="true">🚨</span>
      <div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#991b1b" }}>
          Usage Limit Warning
        </p>
        {alerts.map((alert) => (
          <p key={alert.resource} style={{ margin: "4px 0 0", fontSize: 13, color: "#dc2626" }}>
            You&apos;ve used {alert.percent}% of your monthly {alert.label.toLowerCase()}
            ({alert.used.toLocaleString()}/{alert.limit.toLocaleString()}).
            {" "}
            <a href="/tenant-admin/usage" style={{ color: "#991b1b", textDecoration: "underline" }}>
              Upgrade or contact admin.
            </a>
          </p>
        ))}
      </div>
    </div>
  );
}

export default UsageWarningBanner;
