"use client";

import { useState } from "react";
import { PageHeader, StatGrid, StatCard } from "@/app/_components/ds";

interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description: string;
  lastDeliveryStatus: number | null;
  createdAt: string;
}

interface Delivery {
  id: string;
  eventType: string;
  statusCode: number;
  attempt: number;
  deliveredAt: string;
  responseBody: string;
}

const EVENT_GROUPS = {
  "Finance": ["finance.invoice.created", "finance.payment.completed", "finance.budget.exceeded"],
  "HRMS": ["hrms.employee.created", "hrms.leave.approved", "hrms.attendance.marked"],
  "Procurement": ["procurement.po.created", "procurement.po.approved", "procurement.vendor.registered"],
  "Admin": ["admin.tenant.created", "admin.feature_flag.killed", "admin.backup.completed"],
};

const WEBHOOKS: Webhook[] = [
  { id: "1", url: "https://erp.govdept.in/hooks/finance", events: ["finance.invoice.created", "finance.payment.completed"], active: true, description: "Finance events", lastDeliveryStatus: 200, createdAt: "2024-05-01T10:00:00Z" },
  { id: "2", url: "https://notify.internal.gov.in/webhook", events: ["hrms.employee.created", "hrms.leave.approved"], active: true, description: "HRMS notifications", lastDeliveryStatus: 200, createdAt: "2024-04-15T08:00:00Z" },
  { id: "3", url: "https://old-system.nic.in/api/hook", events: ["procurement.po.created"], active: false, description: "Legacy sync (paused)", lastDeliveryStatus: 500, createdAt: "2024-03-01T12:00:00Z" },
];

const DELIVERIES: Delivery[] = [
  { id: "d1", eventType: "finance.invoice.created", statusCode: 200, attempt: 1, deliveredAt: "2024-06-10T14:32:00Z", responseBody: '{"received":true}' },
  { id: "d2", eventType: "finance.payment.completed", statusCode: 200, attempt: 1, deliveredAt: "2024-06-10T12:15:00Z", responseBody: '{"ok":true}' },
  { id: "d3", eventType: "finance.invoice.created", statusCode: 500, attempt: 3, deliveredAt: "2024-06-09T09:00:00Z", responseBody: "Internal Server Error" },
  { id: "d4", eventType: "finance.payment.completed", statusCode: 200, attempt: 1, deliveredAt: "2024-06-08T16:45:00Z", responseBody: '{"processed":true}' },
];

function statusCodeBadge(code: number | null) {
  if (!code) return <span style={{ color: "#6b7280" }}>—</span>;
  const isOk = code >= 200 && code < 300;
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 12, fontWeight: 600, background: isOk ? "#ecfdf5" : "#fef2f2", color: isOk ? "#059669" : "#dc2626" }}>
      {code}
    </span>
  );
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>(WEBHOOKS);
  const [selectedWebhook, setSelectedWebhook] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  function handleTest(id: string) {
    setTestResult(`Test event sent to webhook ${id}. Check delivery log.`);
    setTimeout(() => setTestResult(null), 3000);
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Outbound Webhooks" subtitle="Configure HTTP callbacks for domain events with HMAC-SHA256 signatures." back="/tenant-admin" />

      <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <p style={{ margin: 0, fontSize: 14, color: "#166534" }}>
          🔐 <strong>Security:</strong> We sign every payload with HMAC-SHA256. Verify the <code>X-CivitasOne-Signature</code> header in your endpoint.
        </p>
      </div>

      {testResult && (
        <div role="alert" style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#065f46" }}>✅ {testResult}</p>
        </div>
      )}

      <StatGrid>
        <StatCard icon="🔗" iconBg="#eef2ff" label="Total Webhooks" value={webhooks.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={webhooks.filter((w) => w.active).length} />
        <StatCard icon="⏸️" iconBg="#f3f4f6" label="Paused" value={webhooks.filter((w) => !w.active).length} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Failed (Last)" value={webhooks.filter((w) => w.lastDeliveryStatus && w.lastDeliveryStatus >= 400).length} />
      </StatGrid>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Registered Webhooks</h3>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Add Webhook</button>
        </div>

        <table className="data-table" role="table" aria-label="Webhooks list">
          <thead>
            <tr>
              <th>URL</th>
              <th>Events</th>
              <th>Status</th>
              <th>Last Delivery</th>
              <th>Actions</th>
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
                  <button className="btn btn-sm" onClick={() => setSelectedWebhook(wh.id)} aria-label={`View deliveries for ${wh.url}`}>
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
      </div>

      {selectedWebhook && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>Delivery Log</h3>
            <button className="btn btn-sm" onClick={() => setSelectedWebhook(null)}>✕ Close</button>
          </div>
          <table className="data-table" role="table" aria-label="Webhook delivery log">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Event Type</th>
                <th>Status</th>
                <th>Attempt</th>
                <th>Response</th>
              </tr>
            </thead>
            <tbody>
              {DELIVERIES.map((d) => (
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
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Create Webhook">
          <div className="modal-content" style={{ maxWidth: 550, padding: 24, borderRadius: 8, background: "#fff" }}>
            <h3>Create Webhook</h3>
            <form onSubmit={(e) => { e.preventDefault(); setShowCreate(false); }}>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="wh-url">Endpoint URL</label>
                <input id="wh-url" type="url" className="input" placeholder="https://your-server.com/webhook" required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label htmlFor="wh-desc">Description</label>
                <input id="wh-desc" type="text" className="input" placeholder="Finance event sync" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontWeight: 500, marginBottom: 8, display: "block" }}>Events to Subscribe</label>
                {Object.entries(EVENT_GROUPS).map(([group, events]) => (
                  <div key={group} style={{ marginBottom: 8 }}>
                    <strong style={{ fontSize: 12, color: "#374151" }}>{group}</strong>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                      {events.map((evt) => (
                        <label key={evt} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, padding: "2px 6px", background: "#f9fafb", borderRadius: 4, cursor: "pointer" }}>
                          <input type="checkbox" value={evt} />
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
    </main>
  );
}
