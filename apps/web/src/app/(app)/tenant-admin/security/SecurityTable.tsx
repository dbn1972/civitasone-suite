"use client";

import { DataTable, maskEmail } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { formatDateTimeIST } from "@/lib/formatters";
import { EXPORT_NOT_RECORDED } from "@/lib/admin/platformExport";
import type { SecurityEvent } from "@/app/_data/loaders";

// GAP-TENANT-ADMIN-SECURITY-05: human labels for known raw event codes, with a
// fallback to a humanised code so an unknown code never renders as a bare slug.
const EVENT_LABELS: Record<string, string> = {
  login_success: "Login succeeded",
  login_failed: "Login failed",
  mfa_challenge: "MFA challenge",
  mfa_enrolled: "MFA enrolled",
  password_reset: "Password reset",
  session_revoked: "Session revoked",
  permission_denied: "Permission denied",
  account_locked: "Account locked",
  api_key_created: "API key created",
  api_key_revoked: "API key revoked",
};

function eventLabel(code: string): string {
  return EVENT_LABELS[code] ?? code.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

// GAP-TENANT-ADMIN-SECURITY-03: map the outcome enum EXPLICITLY. Only genuine
// failures are red; neutral/in-flight states (pending, challenged) are warn,
// not failures, so incident triage is not misled. Unknown values are neutral.
function outcomePill(outcome: string): { cls: string; label: string } {
  switch (outcome) {
    case "success":
      return { cls: "good", label: "Success" };
    case "failure":
    case "failed":
    case "denied":
      return { cls: "bad", label: eventOutcomeText(outcome) };
    case "flagged":
    case "pending":
    case "challenged":
      return { cls: "warn", label: eventOutcomeText(outcome) };
    default:
      return { cls: "mut", label: eventOutcomeText(outcome) };
  }
}

function eventOutcomeText(outcome: string): string {
  return outcome.replace(/^./, (c) => c.toUpperCase());
}

// Source IPs are personal data under DPDP — mask by default, keeping only the
// first octet for rough geo/debug recognisability.
function maskIp(ip: string): string {
  const v = ip.trim();
  if (!v) return v;
  if (v.includes(":")) {
    // IPv6: keep the first hextet only.
    const head = v.split(":")[0];
    return `${head}:••••`;
  }
  const parts = v.split(".");
  if (parts.length !== 4) return "•••";
  return `${parts[0]}.•••.•••.•••`;
}

/**
 * GAP-TENANT-ADMIN-SECURITY-04: a Security Center CSV export carries actor
 * emails and source IPs. FAIL-CLOSED: the server records the export in the
 * audit trail before the (masked) file is built; a failed audit call blocks
 * the download. Masked values are what the table (and therefore the CSV) shows.
 */
async function securityExportGuard(info: { rowCount: number; filter: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/proxy/v1/admin/security-exports/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rowCount: info.rowCount, filtered: info.filter.trim().length > 0 }),
    });
    return res.ok ? { ok: true } : { ok: false, message: EXPORT_NOT_RECORDED };
  } catch {
    return { ok: false, message: EXPORT_NOT_RECORDED };
  }
}

export function SecurityTable({ events, source }: { events: SecurityEvent[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("admin.security.events", events, source, (d) => d.length === 0);

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<SecurityEvent & Record<string, unknown>>
        columns={[
          // GAP-TENANT-ADMIN-SECURITY-05: TZ-safe formatter (Asia/Kolkata) so
          // server and client markup match (no hydration mismatch).
          { key: "timestamp", label: "Time", render: (row) => formatDateTimeIST(row.timestamp as string), csv: (row) => formatDateTimeIST(row.timestamp as string) },
          { key: "type", label: "Event", render: (row) => eventLabel(row.type as string), csv: (row) => eventLabel(row.type as string) },
          // GAP-TENANT-ADMIN-SECURITY-04: actor emails + IPs masked by default
          // (both on screen AND in the exported CSV — `csv` masks the value, as
          // a render-only column would otherwise export the raw PII).
          { key: "actor", label: "Actor", render: (row) => maskEmail(row.actor as string), csv: (row) => maskEmail(row.actor as string) },
          { key: "ipAddress", label: "IP Address", render: (row) => maskIp(row.ipAddress as string), csv: (row) => maskIp(row.ipAddress as string) },
          {
            key: "outcome",
            label: "Outcome",
            render: (row) => {
              const p = outcomePill(row.outcome as string);
              return <span className={`pill ${p.cls}`}>{p.label}</span>;
            },
            csv: (row) => outcomePill(row.outcome as string).label,
          },
        ]}
        rows={data as (SecurityEvent & Record<string, unknown>)[]}
        sortable
        filterable
        filterPlaceholder="Search events..."
        pageSize={15}
        exportable
        exportFilename="security-events"
        exportGuard={securityExportGuard}
        exportNotice="Actor emails and IP addresses are masked; the export is recorded in the audit trail."
      />
    </>
  );
}
