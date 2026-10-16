import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";
import { getWebhooks } from "@/app/_data/loaders";
import { WebhooksClient } from "./WebhooksClient";

export default async function WebhooksPage() {
  const { data: webhooks, source } = await getWebhooks();
  const activeCount = webhooks.filter((w) => w.active).length;
  const failedCount = webhooks.filter((w) => w.lastDeliveryStatus && w.lastDeliveryStatus >= 400).length;

  return (
    <div className="page-main wrap">
      {/* UX-012: the data-source badge now lives inside WebhooksClient,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the client's own cache state (UX-002's pattern). */}
      <PageHeader title="Outbound Webhooks" subtitle="Configure HTTP callbacks for domain events with HMAC-SHA256 signatures." />

      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <p style={{ margin: 0, fontSize: 14, color: "#166534" }}>
          🔐 <strong>Security:</strong> We sign every payload with HMAC-SHA256. Verify the <code>X-CivitasOne-Signature</code> header in your endpoint.
        </p>
      </div>

      <StatGrid>
        <StatCard icon="🔗" tone="neutral" label="Total Webhooks" value={webhooks.length} />
        <StatCard icon="✅" tone="good" label="Active" value={activeCount} />
        <StatCard icon="⏸️" tone="neutral" label="Paused" value={webhooks.filter((w) => !w.active).length} />
        <StatCard icon="❌" tone="bad" label="Failed (Last)" value={failedCount} />
      </StatGrid>

      <WebhooksClient webhooks={webhooks} source={source} />
    </div>
  );
}
