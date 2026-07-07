import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getWebhooks } from "@/app/_data/loaders";
import { WebhooksClient } from "./WebhooksClient";

export default async function WebhooksPage() {
  const { data: webhooks, source } = await getWebhooks();
  const activeCount = webhooks.filter((w) => w.active).length;
  const failedCount = webhooks.filter((w) => w.lastDeliveryStatus && w.lastDeliveryStatus >= 400).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Outbound Webhooks" subtitle="Configure HTTP callbacks for domain events with HMAC-SHA256 signatures." back="/tenant-admin" />
      <DataSourceBadge source={source} />

      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <p style={{ margin: 0, fontSize: 14, color: "#166534" }}>
          🔐 <strong>Security:</strong> We sign every payload with HMAC-SHA256. Verify the <code>X-CivitasOne-Signature</code> header in your endpoint.
        </p>
      </div>

      <StatGrid>
        <StatCard icon="🔗" iconBg="#eef2ff" label="Total Webhooks" value={webhooks.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={activeCount} />
        <StatCard icon="⏸️" iconBg="#f3f4f6" label="Paused" value={webhooks.filter((w) => !w.active).length} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Failed (Last)" value={failedCount} />
      </StatGrid>

      <WebhooksClient webhooks={webhooks} source={source} />
    </main>
  );
}
