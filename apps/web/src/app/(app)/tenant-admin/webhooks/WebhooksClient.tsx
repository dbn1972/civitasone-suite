"use client";

import { useState } from "react";
import { Button, EmptyState, Modal, ConfirmDialog, StatusPill, RefreshErrorState, useToast } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";
import type { WebhookSummary, WebhookDelivery } from "@/app/_data/loaders";

const EVENT_GROUPS: Record<string, string[]> = {
  "Finance": ["finance.invoice.created", "finance.payment.completed", "finance.budget.exceeded"],
  "HRMS": ["hrms.employee.created", "hrms.leave.approved", "hrms.attendance.marked"],
  "Procurement": ["procurement.po.created", "procurement.po.approved", "procurement.vendor.registered"],
  "Admin": ["admin.tenant.created", "admin.feature_flag.killed", "admin.backup.completed"],
};

// All admin webhook calls go through the authenticated proxy (GAP-WEBHOOKS-07):
// /api/proxy/v1/admin/webhooks -> gateway /api/v1/admin/webhooks. The direct
// /api/v1/... calls had no auth header attached.
const BASE = "/api/proxy/v1/admin/webhooks";

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
  const { data: seededWebhooks, provenance, offline, cachedAt } = useSeededResource("admin.webhooks", initialWebhooks, source, (d) => d.length === 0);
  const [webhooks, setWebhooks] = useState<WebhookSummary[]>(seededWebhooks);
  const [selected, setSelected] = useState<WebhookSummary | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newSecret, setNewSecret] = useState<{ url: string; secret: string } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WebhookSummary | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const { toast } = useToast();
  const testError = useFormError("webhook");

  function refreshList() {
    void (async () => {
      try {
        const res = await fetch(BASE, { credentials: "same-origin" });
        if (!res.ok) return;
        const payload = await res.json();
        const items = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
        setWebhooks(items as WebhookSummary[]);
      } catch {
        // keep current list; a transient refresh failure is non-fatal
      }
    })();
  }

  // GAP-TENANT-ADMIN-WEBHOOKS-03: Test is no longer fire-and-forget. We await
  // the response, show success only on ok and a clerk-safe error otherwise, and
  // name the webhook URL (not the raw id).
  async function handleTest(wh: WebhookSummary) {
    setTestingId(wh.id);
    testError.clear();
    try {
      const res = await fetch(`${BASE}/${wh.id}/test`, { method: "POST", credentials: "same-origin" });
      if (!res.ok) {
        toast.error((await testError.fromResponse(res, "save")).message);
        return;
      }
      toast.success(`Test event queued for ${wh.url}. See the delivery log for the result.`);
      // Open the delivery log so the admin sees the result land.
      void handleViewDeliveries(wh);
    } catch (caught) {
      toast.error(testError.fromException("save", caught).message);
    } finally {
      setTestingId(null);
    }
  }

  // GAP-TENANT-ADMIN-WEBHOOKS-06: delivery-log failures are surfaced (not
  // swallowed into "No deliveries yet"); deliveries are cleared when switching
  // webhook; a loading state is shown.
  async function handleViewDeliveries(wh: WebhookSummary) {
    setSelected(wh);
    setDeliveries([]);
    setDeliveriesError(false);
    setDeliveriesLoading(true);
    try {
      const res = await fetch(`${BASE}/${wh.id}/deliveries`, { credentials: "same-origin" });
      if (!res.ok) {
        setDeliveriesError(true);
        return;
      }
      const payload = await res.json();
      const items = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
      setDeliveries(items as WebhookDelivery[]);
    } catch {
      setDeliveriesError(true);
    } finally {
      setDeliveriesLoading(false);
    }
  }

  // GAP-TENANT-ADMIN-WEBHOOKS-04: pause/resume via PUT {active}.
  async function handleToggleActive(wh: WebhookSummary) {
    setActionBusy(true);
    try {
      const res = await fetch(`${BASE}/${wh.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ active: !wh.active }),
      });
      if (!res.ok) {
        toast.error((await mapWebhookError(res)).message);
        return;
      }
      toast.success(`${wh.url} ${wh.active ? "paused" : "resumed"}.`);
      refreshList();
    } catch {
      toast.error("Couldn't update the webhook. Please try again.");
    } finally {
      setActionBusy(false);
    }
  }

  // GAP-TENANT-ADMIN-WEBHOOKS-04: rotate the signing secret (maker step). The
  // new secret is held pending a second admin's approval server-side, so no
  // secret is shown here.
  async function handleRotate(wh: WebhookSummary) {
    setActionBusy(true);
    try {
      const res = await fetch(`${BASE}/${wh.id}/rotate-secret`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        toast.error((await mapWebhookError(res)).message);
        return;
      }
      toast.success(`Secret rotation requested for ${wh.url}. A second admin must approve it before it takes effect.`);
    } catch {
      toast.error("Couldn't request secret rotation. Please try again.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDelete(reason?: string) {
    if (!pendingDelete) return;
    const wh = pendingDelete;
    setActionBusy(true);
    setDeleteError(undefined);
    try {
      const res = await fetch(`${BASE}/${wh.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(reason ? { reason } : {}),
      });
      if (!res.ok) {
        setDeleteError((await mapWebhookError(res)).message);
        return;
      }
      setPendingDelete(null);
      if (selected?.id === wh.id) setSelected(null);
      toast.success(`${wh.url} deleted.`);
      refreshList();
    } catch {
      setDeleteError("Couldn't delete the webhook. Please try again.");
    } finally {
      setActionBusy(false);
    }
  }

  // Small local helper so the toasts above share the clerk-safe mapping.
  const whError = useFormError("webhook");
  async function mapWebhookError(res: Response) {
    return whError.fromResponse(res, "save");
  }

  return (
    <>
      {/* UX-012: single source of provenance (see UsersTable pattern). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Registered Webhooks</h3>
          <Button onClick={() => setShowCreate(true)}>+ Add Webhook</Button>
        </div>

        {webhooks.length === 0 ? (
          <EmptyState icon="🔗" title="No webhooks configured" message="Add a webhook to receive HTTP callbacks when domain events occur." action={<Button onClick={() => setShowCreate(true)}>+ Add Webhook</Button>} />
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
                    {/* GAP-WEBHOOKS-07: StatusPill instead of ●/○ glyphs. */}
                    <StatusPill status={wh.active ? "active" : "paused"} label={wh.active ? "Active" : "Paused"} />
                  </td>
                  <td>{statusCodeBadge(wh.lastDeliveryStatus)}</td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Button size="sm" onClick={() => void handleViewDeliveries(wh)} aria-label={`View deliveries for ${wh.url}`}>Log</Button>
                    <Button size="sm" disabled={testingId === wh.id} onClick={() => void handleTest(wh)} aria-label={`Send test event to ${wh.url}`}>
                      {testingId === wh.id ? "Testing…" : "Test"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={actionBusy} onClick={() => void handleToggleActive(wh)} aria-label={`${wh.active ? "Pause" : "Resume"} ${wh.url}`}>
                      {wh.active ? "Pause" : "Resume"}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={actionBusy} onClick={() => void handleRotate(wh)} aria-label={`Rotate signing secret for ${wh.url}`}>
                      Rotate secret
                    </Button>
                    <Button size="sm" variant="danger" disabled={actionBusy} onClick={() => { setDeleteError(undefined); setPendingDelete(wh); }} aria-label={`Delete ${wh.url}`}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>Delivery Log — <code style={{ fontSize: 12 }}>{selected.url}</code></h3>
            <Button size="sm" onClick={() => setSelected(null)}>Close</Button>
          </div>
          {deliveriesLoading ? (
            <div className="skeleton" style={{ height: 120, margin: 16 }} aria-label="Loading deliveries" />
          ) : deliveriesError ? (
            // GAP-WEBHOOKS-06: a failed deliveries fetch shows an error + retry,
            // never "No deliveries yet".
            <RefreshErrorState error={toHumanError("load", { area: "webhook deliveries" })} onBack={() => void handleViewDeliveries(selected)} />
          ) : deliveries.length === 0 ? (
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
                    {/* GAP-WEBHOOKS-06: use the API's max attempts when present,
                        else just the attempt number — never a hard-coded /3. */}
                    <td>{d.maxAttempts ? `${d.attempt}/${d.maxAttempts}` : d.attempt}</td>
                    <td><code style={{ fontSize: 11, color: "#6b7280" }}>{d.responseBody.slice(0, 40)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <CreateWebhookDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(created, url) => {
          setShowCreate(false);
          // GAP-WEBHOOKS-02: show the one-time signing secret.
          if (created.secret) setNewSecret({ url, secret: created.secret });
          refreshList();
        }}
      />

      {/* GAP-WEBHOOKS-02: one-time secret reveal. Cleared from state on close;
          never persisted or logged. */}
      <Modal open={newSecret !== null} onClose={() => setNewSecret(null)} title="Signing secret — shown once" role="alertdialog">
        {newSecret && (
          <div style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 13 }}>
              Copy the signing secret for <code>{newSecret.url}</code> now. For security it is <b>shown only once</b> and cannot be retrieved later — if you lose it, rotate the secret to generate a new one.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code style={{ flex: 1, padding: "8px 10px", background: "#f3f4f6", borderRadius: 6, fontSize: 12, wordBreak: "break-all" }}>{newSecret.secret}</code>
              <Button size="sm" onClick={() => void navigator.clipboard?.writeText(newSecret.secret)}>Copy</Button>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button onClick={() => setNewSecret(null)}>I&apos;ve saved it</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* GAP-WEBHOOKS-04: delete requires an audited reason. */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this webhook?"
        description={<>Deleting <code>{pendingDelete?.url}</code> stops all future deliveries to it. This cannot be undone.</>}
        confirmLabel="Delete webhook"
        danger
        requireReason
        reasonLabel="Reason (recorded in the audit log)"
        busy={actionBusy}
        errorMessage={deleteError}
        onConfirm={(reason) => void handleDelete(reason)}
        onCancel={() => { if (!actionBusy) { setPendingDelete(null); setDeleteError(undefined); } }}
      />
    </>
  );
}

function CreateWebhookDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: { id: string; secret: string }, url: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const formError = useFormError("webhook");

  function toggleEvent(evt: string, on: boolean) {
    setEvents((prev) => (on ? [...prev, evt] : prev.filter((e) => e !== evt)));
  }

  // GAP-WEBHOOKS-05 (client guard; the server also enforces SSRF + >=1 event):
  // require https and at least one event before enabling Create.
  const isHttps = /^https:\/\//i.test(url.trim());
  const canSubmit = isHttps && events.length > 0 && !busy;

  async function submit() {
    setBusy(true);
    setError(undefined);
    formError.clear();
    try {
      const res = await fetch(BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ url: url.trim(), description: description.trim(), events }),
      });
      if (!res.ok) {
        // GAP-WEBHOOKS-01: keep the dialog open and show the error; never
        // fabricate a row.
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      const created = (await res.json()) as { id: string; secret: string };
      const submittedUrl = url.trim();
      setUrl(""); setDescription(""); setEvents([]);
      onCreated(created, submittedUrl);
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title="Create Webhook" size="lg">
      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <label htmlFor="wh-url" style={{ display: "block", fontSize: 12.5, fontWeight: 650, marginBottom: 4 }}>Endpoint URL (https)</label>
          <input id="wh-url" value={url} onChange={(e) => setUrl(e.target.value)} type="url" className="ta-input" placeholder="https://your-server.com/webhook" aria-invalid={url.length > 0 && !isHttps ? true : undefined} />
          {url.length > 0 && !isHttps ? <p role="alert" style={{ color: "#b42318", fontSize: 12, margin: "4px 0 0" }}>The endpoint must use https.</p> : null}
        </div>
        <div>
          <label htmlFor="wh-desc" style={{ display: "block", fontSize: 12.5, fontWeight: 650, marginBottom: 4 }}>Description</label>
          <input id="wh-desc" value={description} onChange={(e) => setDescription(e.target.value)} type="text" className="ta-input" placeholder="Finance event sync" />
        </div>
        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 650, fontSize: 12.5, marginBottom: 8 }}>Events to subscribe (at least one)</legend>
          {Object.entries(EVENT_GROUPS).map(([group, evts]) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 12, color: "#374151" }}>{group}</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                {evts.map((evt) => (
                  <label key={evt} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, padding: "2px 6px", background: "#f9fafb", borderRadius: 4, cursor: "pointer" }}>
                    <input type="checkbox" checked={events.includes(evt)} onChange={(e) => toggleEvent(evt, e.target.checked)} />
                    {evt.split(".").slice(1).join(".")}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {events.length === 0 ? <p style={{ fontSize: 12, color: "#6b7280", margin: "4px 0 0" }}>Select at least one event to enable Create.</p> : null}
        </fieldset>
        <div style={{ background: "#f9fafb", padding: 12, borderRadius: 6 }}>
          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>A signing secret will be generated and shown once after creation.</p>
        </div>
        {error ? <p role="alert" style={{ color: "#b42318", fontSize: 13, margin: 0 }}>{error}</p> : null}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" disabled={busy} onClick={() => { if (!busy) onClose(); }}>Cancel</Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>{busy ? "Creating…" : "Create Webhook"}</Button>
        </div>
      </div>
    </Modal>
  );
}
