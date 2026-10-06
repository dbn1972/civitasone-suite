"use client";

import { DataTable, StatusPill, Masked, maskEmail } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { MfaUserStatus } from "@/app/_data/loaders";

const EXPORT_NOT_RECORDED =
  "Couldn't record this export in the audit trail, so no file was created. Try again.";

// GAP-TENANT-ADMIN-MFA-03: FAIL-CLOSED audited export. The file is only built
// after admin-service accepts the audit record (POST /v1/admin/mfa-exports/
// audit). A failed or unreachable audit call shows a plain-language message and
// nothing leaves the screen. Never carries a status code or server text.
async function mfaExportGuard(info: { rowCount: number; filter: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/proxy/v1/admin/mfa-exports/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rowCount: info.rowCount, filtered: info.filter.trim().length > 0 }),
    });
    return res.ok ? { ok: true } : { ok: false, message: EXPORT_NOT_RECORDED };
  } catch {
    return { ok: false, message: EXPORT_NOT_RECORDED };
  }
}

// GAP-TENANT-ADMIN-MFA-04 / MFA-02: the backend emits only "enabled"/"disabled"
// (admin-service maps a boolean mfaEnabled). Give each known value a clear,
// consistent label + tone; unknowns fall through to StatusPill's humanizer.
const MFA_LABEL: Record<string, { label: string; variant: "good" | "warn" | "mut" | "bad" | "info" }> = {
  enabled: { label: "Enrolled", variant: "good" },
  active: { label: "Enrolled", variant: "good" },
  enrolled: { label: "Enrolled", variant: "good" },
  pending: { label: "Pending", variant: "warn" },
  disabled: { label: "Not enrolled", variant: "mut" },
  not_enrolled: { label: "Not enrolled", variant: "mut" },
};

function mfaPill(status: string) {
  const key = status.trim().toLowerCase();
  const m = MFA_LABEL[key];
  return m ? <StatusPill status={status} label={m.label} variant={m.variant} /> : <StatusPill status={status} />;
}

export function MfaTable({ users, source }: { users: MfaUserStatus[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("admin.mfa.users", users, source, (d) => d.length === 0);

  return (
    <>
      {/* UX-012: single provenance source for the rows below. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<MfaUserStatus & Record<string, unknown>>
        columns={[
          { key: "name", label: "Name" },
          {
            key: "email",
            label: "Email",
            // GAP-TENANT-ADMIN-MFA-03: email is DPDP personal data — masked on
            // screen AND in the CSV (the csv override emits the same masked
            // form, so a bulk export never leaks full addresses).
            render: (row) => <Masked value={row.email as string} kind="email" ariaLabel="Email address, masked" />,
            csv: (row) => maskEmail(String(row.email ?? "")),
          },
          { key: "department", label: "Department", render: (row) => (row.department ? String(row.department) : "—") },
          { key: "mfaStatus", label: "MFA Status", render: (row) => mfaPill(row.mfaStatus as string) },
          { key: "enrolledAt", label: "Enrolled On", render: (row) => row.enrolledAt ? new Date(row.enrolledAt as string).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—" },
        ]}
        rows={data as (MfaUserStatus & Record<string, unknown>)[]}
        sortable
        filterable
        filterPlaceholder="Search users..."
        pageSize={15}
        // GAP-TENANT-ADMIN-MFA-01: a row opens the user's security page.
        rowHref={(r) => `/tenant-admin/users/${r.id}`}
        exportable
        exportFilename="mfa-status"
        exportGuard={mfaExportGuard}
        exportConfirm={{
          title: "Export MFA status",
          description: "This downloads staff names and masked email addresses. The export is recorded in the audit trail.",
          confirmLabel: "Export",
        }}
        exportNotice="Personal data — export is audited."
      />
    </>
  );
}
