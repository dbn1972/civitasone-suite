import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function FeatureFlagsPage() {
  type Row = { flagKey: string; description: string; enabledPct: string; rollout: string; status: string };

  const rows: Row[] = [
    { flagKey: "new-dashboard-v2", description: "Redesigned analytics dashboard with widgets", enabledPct: "25%", rollout: "Gradual", status: "Rolling Out" },
    { flagKey: "ai-insights-module", description: "ML-powered insights and recommendations", enabledPct: "100%", rollout: "Full", status: "Active" },
    { flagKey: "bulk-payment-pfms", description: "Bulk payment via PFMS integration", enabledPct: "50%", rollout: "Gradual", status: "Rolling Out" },
    { flagKey: "mobile-biometric-auth", description: "Fingerprint/face auth for mobile app", enabledPct: "0%", rollout: "Disabled", status: "Disabled" },
    { flagKey: "geo-fencing-attendance", description: "GPS-based attendance verification", enabledPct: "75%", rollout: "Gradual", status: "Rolling Out" },
    { flagKey: "e-sign-dsc", description: "Digital Signature Certificate e-Sign", enabledPct: "100%", rollout: "Full", status: "Active" },
    { flagKey: "chatbot-citizen-portal", description: "AI chatbot for citizen self-service", enabledPct: "10%", rollout: "Beta", status: "Beta" },
    { flagKey: "dark-mode-ui", description: "Dark theme for web application", enabledPct: "0%", rollout: "Disabled", status: "Disabled" },
  ];

  const columns = [
    { key: "flagKey" as const, label: "Flag Key" },
    { key: "description" as const, label: "Description" },
    { key: "enabledPct" as const, label: "Enabled %" },
    { key: "rollout" as const, label: "Rollout" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Feature Flags" subtitle="Platform feature toggles with gradual rollout controls." back="/admin" />
      <StatGrid>
        <StatCard icon="🚩" iconBg="#eef2ff" label="Total Flags" value={8} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active (100%)" value={2} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="Rolling Out" value={3} />
        <StatCard icon="⛔" iconBg="#fce7ee" label="Disabled" value={2} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Flag Registry</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
