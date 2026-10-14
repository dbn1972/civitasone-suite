"use client";

import { Alert } from "./ds";

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
    <Alert variant="danger" aria-live="polite" title="Usage Limit Warning" style={{ borderRadius: 8, padding: "12px 20px" }}>
      {alerts.map((alert) => (
        <p key={alert.resource} style={{ margin: "4px 0 0", fontSize: 13 }}>
          You&apos;ve used {alert.percent}% of your monthly {alert.label.toLowerCase()}
          ({alert.used.toLocaleString("en-IN")}/{alert.limit.toLocaleString("en-IN")}).
          {" "}
          <a href="/tenant-admin/usage" style={{ color: "inherit", textDecoration: "underline" }}>
            Upgrade or contact admin.
          </a>
        </p>
      ))}
    </Alert>
  );
}
