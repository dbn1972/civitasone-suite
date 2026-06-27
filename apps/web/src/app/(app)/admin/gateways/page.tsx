import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function GatewaysPage() {
  type Row = { type: string; provider: string; status: string; messagesPerDay: string; successRate: string; lastChecked: string };

  const rows: Row[] = [
    { type: "SMS", provider: "NIC SMS Gateway", status: "Active", messagesPerDay: "12,400", successRate: "98.5%", lastChecked: "2025-02-10 09:00" },
    { type: "Email", provider: "Gov Email (NIC)", status: "Active", messagesPerDay: "8,200", successRate: "99.1%", lastChecked: "2025-02-10 09:00" },
    { type: "WhatsApp", provider: "WhatsApp Business API", status: "Active", messagesPerDay: "3,800", successRate: "97.2%", lastChecked: "2025-02-10 09:00" },
    { type: "Push Notification", provider: "Firebase Cloud Messaging", status: "Active", messagesPerDay: "15,600", successRate: "94.8%", lastChecked: "2025-02-10 09:00" },
    { type: "SMS (Backup)", provider: "CDAC mGov", status: "Standby", messagesPerDay: "0", successRate: "—", lastChecked: "2025-02-09 18:00" },
    { type: "Email (Transactional)", provider: "AWS SES", status: "Active", messagesPerDay: "2,100", successRate: "99.8%", lastChecked: "2025-02-10 09:00" },
    { type: "Voice IVR", provider: "Exotel", status: "Degraded", messagesPerDay: "450", successRate: "89.2%", lastChecked: "2025-02-10 08:45" },
  ];

  const columns = [
    { key: "type" as const, label: "Type" },
    { key: "provider" as const, label: "Provider" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
    { key: "messagesPerDay" as const, label: "Messages/Day", align: "right" as const },
    { key: "successRate" as const, label: "Success Rate" },
    { key: "lastChecked" as const, label: "Last Checked" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Communication Gateways" subtitle="SMS, email, WhatsApp and push notification gateway status." back="/admin" />
      <StatGrid>
        <StatCard icon="📡" iconBg="#eef2ff" label="Total Gateways" value={7} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={5} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Degraded" value={1} />
        <StatCard icon="📨" iconBg="#fce7ee" label="Messages Today" value="42,550" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Gateway Status</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
