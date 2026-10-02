import { PageHeader, StatGrid, StatCard, DataTable, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { DEVICE_ADMIN_ROLES } from "@/lib/auth/adminRoles";

type Row = {
  id: string;
  deviceName: string;
  platform: string;
  osVersion: string;
  appVersion: string;
  isRooted: boolean;
  hasScreenLock: boolean;
  trustStatus: string;
  flaggedReason: string;
  lastSeen: string;
  lastIp: string;
  loginCount: number;
  employeeName: string;
  employeeCode: string;
  department: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/devices/admin", [], {
    telemetryKey: "admin.devices",
    mapResponse: (p) => {
      const arr = (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function DevicesPage() {
  // GAP-ADMIN-DEVICES-01: hrms-service gates GET /v1/hrms/devices/admin to
  // hr_admin/it_admin/super_admin (names, codes, departments, last IPs).
  requireAnyRole(DEVICE_ADMIN_ROLES);
  const res = await getData();

  // GAP-ADMIN-DEVICES-02: a failed fetch used to render "Total Devices 0,
  // Blocked 0" -- a security-posture screen that looks clean when it is blind.
  if (res.source === "error") {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Device Trust & Compliance"
          subtitle="Monitor all devices accessing organization data — block, flag, or trust"
        />
        <LoadErrorState result={res} area="devices" backHref="/admin" requiredRoles={DEVICE_ADMIN_ROLES} />
      </div>
    );
  }
  const items = res.data;

  const trusted = items.filter((i) => i.trustStatus === "trusted").length;
  const flagged = items.filter((i) => i.trustStatus === "flagged").length;
  const blocked = items.filter((i) => i.trustStatus === "blocked").length;
  const android = items.filter((i) => i.platform === "android").length;
  const ios = items.filter((i) => i.platform === "ios").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employeeName", label: "Employee" },
    { key: "deviceName", label: "Device" },
    { key: "platform", label: "Platform" },
    { key: "osVersion", label: "OS" },
    { key: "appVersion", label: "App Ver" },
    { key: "lastSeen", label: "Last Active" },
    { key: "loginCount", label: "Logins" },
    { key: "trustStatus", label: "Status", cellType: "status" },
    { key: "flaggedReason", label: "Flags" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Device Trust & Compliance"
        subtitle="Monitor all devices accessing organization data — block, flag, or trust"
      />

      <StatGrid>
        <StatCard icon="📱" iconBg="#e6f0ff" label="Total Devices" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Trusted" value={trusted} />
        <StatCard icon="⚠️" iconBg="#fffbe6" label="Flagged" value={flagged} />
        <StatCard icon="🚫" iconBg="#fef2f2" label="Blocked" value={blocked} />
        <StatCard icon="🤖" iconBg="#f5f5f5" label="Android" value={android} />
        <StatCard icon="🍎" iconBg="#f0f0ff" label="iOS" value={ios} />
      </StatGrid>

      <DataTable columns={columns} rows={items} exportable />
    </div>
  );
}
