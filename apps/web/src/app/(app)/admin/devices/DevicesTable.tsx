"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, DataTable, Segmented, StatusPill } from "@/app/_components/ds";
import type { PillVariant } from "@/app/_components/ds/StatusPill";
import { humanizeStatus } from "@/lib/formatters";

export type DeviceRow = {
  id: string;
  deviceName: string;
  platform: string;
  osVersion: string;
  appVersion: string;
  trustStatus: string;
  flaggedReason: string;
  lastSeen: string;
  loginCount: number;
  employeeName: string;
} & Record<string, unknown>;

const STATUS_OPTIONS = ["All", "Trusted", "Flagged", "Blocked"] as const;
type StatusOption = (typeof STATUS_OPTIONS)[number];

/** `flagged` is deliberately not in StatusPill's global map, so the tone is passed explicitly. */
const TRUST_VARIANT: Record<string, PillVariant> = { trusted: "good", flagged: "warn", blocked: "bad" };

/**
 * GAP-ADMIN-DEVICES-04: the CSV carries employee names and device inventory, so
 * each export is recorded (hrms-service POST /v1/hrms/devices/export-audit, same
 * roles as the list). Fire-and-forget: it never blocks the user's own download.
 */
export async function recordDeviceExport(info: { rowCount: number; filter: string }): Promise<void> {
  await fetch("/api/proxy/v1/hrms/devices/export-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Only whether a search was active is recorded, never the raw search text.
    body: JSON.stringify({ rowCount: info.rowCount, filtered: info.filter.trim() !== "" }),
  });
}

async function setDeviceTrust(id: string, action: "block" | "unblock", reason?: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/proxy/v1/hrms/devices/${encodeURIComponent(id)}/${action}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      ...(action === "block" ? { body: JSON.stringify({ reason }) } : {}),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  if (res.ok) return;
  if (res.status === 403) throw new Error("You don't have permission to change device access.");
  throw new Error("Couldn't update this device. Please try again.");
}

/**
 * GAP-ADMIN-DEVICES-03/-04/-05. Block / unblock are available only here because
 * the page itself is gated to hr_admin / it_admin / super_admin -- the exact roles
 * hrms-service accepts on PATCH /v1/hrms/devices/:id/block|unblock. Blocking cuts
 * an employee's access, so it needs a confirmation and a recorded reason.
 */
export function DevicesTable({ items }: { items: DeviceRow[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusOption>("All");

  const rows = useMemo(
    () => (status === "All" ? items : items.filter((i) => i.trustStatus === status.toLowerCase())),
    [items, status],
  );

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Segmented options={[...STATUS_OPTIONS]} value={status} onChange={(v) => setStatus(v as StatusOption)} />
      </div>
      <DataTable<DeviceRow>
        columns={[
          { key: "employeeName", label: "Employee" },
          { key: "deviceName", label: "Device" },
          { key: "platform", label: "Platform" },
          { key: "osVersion", label: "OS" },
          { key: "appVersion", label: "App Ver" },
          { key: "lastSeen", label: "Last Active", cellType: "datetime" },
          { key: "loginCount", label: "Logins", align: "right" },
          {
            key: "trustStatus",
            label: "Status",
            render: (r) => <StatusPill status={r.trustStatus} variant={TRUST_VARIANT[r.trustStatus] ?? "info"} />,
          },
          {
            key: "flaggedReason",
            label: "Flags",
            render: (r) => (r.flaggedReason ? <span>{humanizeStatus(r.flaggedReason)}</span> : <span>—</span>),
          },
          {
            key: "id",
            label: "Actions",
            sortable: false,
            csvExclude: true,
            render: (r) =>
              r.trustStatus === "blocked" ? (
                <ActionButton
                  label="Unblock"
                  className="btn ghost sm"
                  confirmTitle={`Unblock ${r.deviceName || "this device"}?`}
                  confirmDescription={`${r.employeeName || "The employee"} will be able to sign in from this device again.`}
                  confirmLabel="Unblock device"
                  onConfirm={() => setDeviceTrust(r.id, "unblock")}
                  onSuccess={() => router.refresh()}
                />
              ) : (
                <ActionButton
                  label="Block"
                  className="btn ghost sm"
                  danger
                  requireReason
                  reasonLabel="Reason for blocking"
                  minReasonLength={3}
                  maxReasonLength={200}
                  confirmTitle={`Block ${r.deviceName || "this device"}?`}
                  confirmDescription={`${r.employeeName || "The employee"} will be blocked from this device at its next check-in. Sessions already signed in keep working until they expire. The reason is recorded.`}
                  confirmLabel="Block device"
                  onConfirm={(reason) => setDeviceTrust(r.id, "block", reason)}
                  onSuccess={() => router.refresh()}
                />
              ),
          },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search employee or device…"
        filterKeys={["employeeName", "deviceName"]}
        pageSize={25}
        exportable
        exportFilename="devices"
        onExport={(info) => { void recordDeviceExport(info).catch(() => undefined); }}
        emptyIcon="📱"
        emptyTitle={items.length === 0 ? "No devices yet" : "No devices match"}
        emptyMessage={items.length === 0 ? "Devices appear here once employees sign in from the app." : "Try a different status or search."}
      />
    </div>
  );
}
