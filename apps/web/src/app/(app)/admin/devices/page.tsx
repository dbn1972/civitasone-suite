import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

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

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/devices/admin", [], {
    telemetryKey: "admin.devices",
    mapResponse: (p) => {
      const arr = (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function DevicesPage() {
  const items = await getData();

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
