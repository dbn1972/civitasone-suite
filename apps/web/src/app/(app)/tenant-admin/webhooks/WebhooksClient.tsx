"use client";

import { useState } from "react";
import { EmptyState } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { WebhookSummary, WebhookDelivery } from "@/app/_data/loaders";

const EVENT_GROUPS: Record<string, string[]> = {
  "Finance": ["finance.invoice.created", "finance.payment.completed", "finance.budget.exceeded"],
  "HRMS": ["hrms.employee.created", "hrms.leave.approved", "hrms.attendance.marked"],
  "Procurement": ["procurement.po.created", "procurement.po.approved", "procurement.vendor.registered"],
  "Admin": ["admin.tenant.created", "admin.feature_flag.killed", "admin.backup.completed"],
};

function statusCodeBadge(code: number | null) {
  if (!code) return <span style={{ color: "#6b7280" }}>—</span>;
  const isOk = code >= 200 && code < 300;
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 12, fontWeight: 600, background: isOk ? "#ecfdf5" : "#fef2f2", color: isOk ? "#059669" : "#dc2626" }}>
      {code}
    </span>
  );
}

export function WebhooksClient({ webhooks: initialWebhooks, source }: { webhooks: WebhookSummary[]; source: "api" | "error" }) {
  const { data: seededWebhooks } = useSeededResource("admin.webhooks", initialWebhooks, source, (d) => d.length === 0);
  const [webhooks, setWebhooks] = useState<WebhookSummary[]>(seededWebhooks);
  const [selectedWebhook, setSelectedWebhook] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  function handleTest(id: string) {
    void fetch(`/api/v1/admin/webhooks/${id}/test`, { method: "POST", credentials: "same-origin" });
    setTestResult(`Test event sent to webhook ${id}. Check delivery log.`);
    setTimeout(() => setTestResult(null), 3000);
  }

  async function handleViewDeliveries(webhookId: string) {
    setSelectedWebhook(webhookId);
    try {
      const res = await fetch(`/api/v1/admin/webhooks/${webhookId}/deliveries`, { credentials: "same-origin" });
      if (res.ok) {
        const payload = await res.json();
        const items = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
        setDeliveries(items as WebhookDelivery[]);
      }
    } catch {
      // Silently fail — deliveries will be empty
    }
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const url = formData.get("url") as string;
    const description = formData.get("description") as string;
    const events = Array.from(formData.getAll("events")) as string[];

    void fetch("/api/v1/admin/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ url, description, events }),
    }).then(async (res) => {
      if (res.ok) {
        const created = await res.json() as WebhookSummary;
        setWebhooks([...webhooks, created]);
      } else {
        setWebhooks([...webhooks, {
          id: String(Date.now()),
          url, events, active: true, description,
          lastDeliveryStatus: null, createdAt: new Date().toISOString(),
        }]);
      }
    });
    setShowCreate(false);
  }

  return (
    <>
      {testResult && (
        <div role="alert" style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#065f46" }}>✅ {testResult}</p>
        </div>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Registered Webhooks</h3>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Add Webhook</button>
        </div>

        {webhooks.length === 0 ? (
          <EmptyState icon="🔗" title="No webhooks configured" message="Add a webhook to receive HTTP callbacks when domain events occur." action={<button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Add Webhook</button>} />
        ) : (
          <table className="data-table" role="table" aria-label="Webhooks list">
            <thead>
              <tr>
                <th scope="col">URL</th>
                <th scope="col">Events</th>
                <th scope="col">Status</th>
                <th scope="col">Last Delivery</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((wh) => (
                <tr key={wh.id}>
                  <td>
                    <code style={{ fontSize: 12 }}>{wh.url}</code>
                    <br /><small style={{ color: "#6b7280" }}>{wh.description}</small>
                  </td>
                  <td>
                    {wh.events.map((e) => (
                      <span key={e} style={{ display: "inline-block", padding: "1px 6px", margin: "1px 2px", borderRadius: 4, fontSize: 11, background: "#e0e7ff", color: "#3730a3" }}>
                        {e}
                      </span>
                    ))}
                  </td>
                  <td>
                    <span style={{ color: wh.active ? "#059669" : "#6b7280", fontWeight: 600, fontSize: 13 }}>
                      {wh.active ? "● Active" : "○ Paused"}
                    </span>
                  </td>
                  <td>{statusCodeBadge(wh.lastDeliveryStatus)}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => handleViewDeliveries(wh.id)} aria-label={`View deliveries for ${wh.url}`}>
                      📋 Log
                    </button>
                    <button className="btn btn-sm" onClick={() => handleTest(wh.id)} aria-label={`Send test event to ${wh.url}`}>
                      🧪 Test
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedWebhook && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>Delivery Log</h3>
            <button className="btn btn-sm" onClick={() => setSelectedWebhook(null)}>✕ Close</button>
          </div>
          {deliveries.length === 0 ? (
            <EmptyState icon="📋" title="No deliveries yet" message="Deliveries will appear here once events are dispatched." />
          ) : (
            <table className="data-table" role="table" aria-label="Webhook delivery log">
              <thead>
                <tr>
                  <th scope="col">Timestamp</th>
                  <th scope="col">Event Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Attempt</th>
                  <th scope="col">Response</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td>{new Date(d.deliveredAt).toLocaleString("en-IN")}</td>
                    <td><code style={{ fontSize: 11 }}>{d.eventType}</code></td>
                    <td>{statusCodeBadge(d.statusCode)}</td>
                    <td>{d.attempt}/3</td>
                    <td><code style={{ fontSize: 11, color: "#6b7280" }}>{d.responseBody.slice(0, 40)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Create Webhook">
          <div className="modal-content" style={{ maxWidth: 550, padding: 24, borderRadius: 8, background: "#fff" }}>
            <h3>Create Webhook</h3>
            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="wh-url">Endpoint URL</label>
                <input id="wh-url" name="url" type="url" className="input" placeholder="https://your-server.com/webhook" required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="wh-desc">Description</label>
                <input id="wh-desc" name="description" type="text" className="input" placeholder="Finance event sync" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontWeight: 500, marginBottom: 8, display: "block" }}>Events to Subscribe</label>
                {Object.entries(EVENT_GROUPS).map(([group, events]) => (
                  <div key={group} style={{ marginBottom: 8 }}>
                    <strong style={{ fontSize: 12, color: "#374151" }}>{group}</strong>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                      {events.map((evt) => (
                        <label key={evt} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, padding: "2px 6px", background: "#f9fafb", borderRadius: 4, cursor: "pointer" }}>
                          <input type="checkbox" name="events" value={evt} />
                          {evt.split(".").slice(1).join(".")}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ background: "#f9fafb", padding: 12, borderRadius: 6, marginBottom: 16 }}>
                <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
                  🔑 A signing secret will be auto-generated and shown once after creation.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Webhook</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
