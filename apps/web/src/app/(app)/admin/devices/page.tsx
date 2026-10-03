import { PageHeader, StatGrid, StatCard, LoadErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { DEVICE_ADMIN_ROLES } from "@/lib/auth/adminRoles";
import { DevicesTable } from "./DevicesTable";

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
          subtitle="Monitor devices accessing organization data — block a device or restore access"
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
  // GAP-ADMIN-DEVICES-05: hrms-service also reports "web" devices, so Android + iOS never summed to Total.
  const other = items.length - android - ios;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Device Trust & Compliance"
        subtitle="Monitor devices accessing organization data — block a device or restore access"
      />

      <StatGrid>
        <StatCard icon="📱" iconBg="#e6f0ff" label="Total Devices" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Trusted" value={trusted} />
        <StatCard icon="⚠️" iconBg="#fffbe6" label="Flagged" value={flagged} />
        <StatCard icon="🚫" iconBg="#fef2f2" label="Blocked" value={blocked} />
        <StatCard icon="🤖" iconBg="#f5f5f5" label="Android" value={android} />
        <StatCard icon="🍎" iconBg="#f0f0ff" label="iOS" value={ios} />
        <StatCard icon="🌐" iconBg="#f1f5f9" label="Web / other" value={other} />
      </StatGrid>

      <DevicesTable items={items} />
    </div>
  );
}
