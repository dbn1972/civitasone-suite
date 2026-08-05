"use client";
/**
 * CampaignDetail — MK-001 / MK-004. Shows a campaign's fields and a metrics
 * dashboard (recipients, delivered, responses, conversions, cost, attributed
 * revenue, ROI) and exposes Send / Cancel lifecycle actions guarded by the DS
 * ConfirmDialog.
 *
 * Every metric is gated on source === "error": a failed metrics fetch renders
 * "—" + the saved-info badge, never fabricated zeros. ROI shows "—" when roiBps
 * is null (actual cost 0), never "0%". Money displays with formatMoney (paise
 * strings end-to-end).
 */
import { useEffect, useRef, useState } from "react";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { ConfirmDialog, EmptyState } from "@/app/_components/ds";
import { StatusBadge } from "../../_components/StatusBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import {
  getCampaign,
  getCampaignMetrics,
  sendCampaign,
  cancelCampaign,
  campaignStatusLabel,
  formatRoiBps,
  type Campaign,
  type CampaignMetrics,
  type Source,
} from "@/lib/notifications/campaigns";

type LoadSource = Source | "loading";
type Action = "send" | "cancel";

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignSource, setCampaignSource] = useState<LoadSource>("loading");
  const [metrics, setMetrics] = useState<CampaignMetrics | null>(null);
  const [metricsSource, setMetricsSource] = useState<LoadSource>("loading");

  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");

  // Guards setState in post-mutation reloads: if the user navigates away while a
  // send/cancel is in flight, don't set state on an unmounted component.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function loadCampaign(isLive: () => boolean = () => true) {
    setCampaignSource("loading");
    const { data, source } = await getCampaign(campaignId);
    if (!isLive()) return;
    setCampaign(data);
    setCampaignSource(source);
  }
  async function loadMetrics(isLive: () => boolean = () => true) {
    setMetricsSource("loading");
    const { data, source } = await getCampaignMetrics(campaignId);
    if (!isLive()) return;
    setMetrics(data);
    setMetricsSource(source);
  }

  useEffect(() => {
    let live = true;
    void loadCampaign(() => live);
    void loadMetrics(() => live);
    return () => {
      live = false;
    };
  }, [campaignId]);

  async function runAction(action: Action) {
    setBusy(true);
    setActionError("");
    setMessage("");
    try {
      if (action === "send") await sendCampaign(campaignId);
      else await cancelCampaign(campaignId);
      setConfirm(null);
      setMessage(action === "send" ? "Campaign queued to send." : "Campaign cancelled.");
      await loadCampaign(() => mountedRef.current);
      await loadMetrics(() => mountedRef.current);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const status = campaign?.status ?? "";
  const canSend = campaignSource === "api" && (status === "draft" || status === "scheduled");
  const canCancel = campaignSource === "api" && status !== "cancelled" && status !== "sent";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ----------------------------------------------------------- fields -- */}
      <div className="card">
        <div className="card-h">
          <h3>Campaign</h3>
          {campaignSource === "error" ? <DataSourceBadge source="error" /> : null}
        </div>

        {message ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", padding: "0 12px" }}>
            {message}
          </p>
        ) : null}
        {actionError ? (
          <p role="alert" aria-live="assertive" style={{ fontSize: 13, color: "#b42318", padding: "0 12px" }}>
            {actionError}
          </p>
        ) : null}

        {campaignSource === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: "0 12px" }}>
            Loading campaign…
          </p>
        ) : campaignSource === "error" || !campaign ? (
          <EmptyState icon="📣" title="—" message="Campaign could not be loaded. Showing saved information." />
        ) : (
          <>
            <dl style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, padding: "0 12px", margin: 0 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <dt style={{ minWidth: 160, color: "var(--muted)", fontSize: 13, margin: 0 }}>Name</dt>
                <dd style={{ margin: 0, fontSize: 14 }}>{campaign.name || "(untitled)"}</dd>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <dt style={{ minWidth: 160, color: "var(--muted)", fontSize: 13, margin: 0 }}>Status</dt>
                <dd style={{ margin: 0, fontSize: 14 }}>
                  <StatusBadge status={campaign.status} label={campaignStatusLabel(campaign.status)} />
                </dd>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <dt style={{ minWidth: 160, color: "var(--muted)", fontSize: 13, margin: 0 }}>Objective</dt>
                <dd style={{ margin: 0, fontSize: 14 }}>{campaign.objective ?? "—"}</dd>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <dt style={{ minWidth: 160, color: "var(--muted)", fontSize: 13, margin: 0 }}>Budget</dt>
                <dd style={{ margin: 0, fontSize: 14 }}>{campaign.budgetMinor !== undefined ? formatMoney(campaign.budgetMinor) : "—"}</dd>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <dt style={{ minWidth: 160, color: "var(--muted)", fontSize: 13, margin: 0 }}>Audience segment</dt>
                <dd style={{ margin: 0, fontSize: 14 }}>{campaign.audienceSegmentId ?? "—"}</dd>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <dt style={{ minWidth: 160, color: "var(--muted)", fontSize: 13, margin: 0 }}>Scheduled at</dt>
                <dd style={{ margin: 0, fontSize: 14 }}>{campaign.scheduledAt ? formatIndianDate(campaign.scheduledAt) : "—"}</dd>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <dt style={{ minWidth: 160, color: "var(--muted)", fontSize: 13, margin: 0 }}>Created</dt>
                <dd style={{ margin: 0, fontSize: 14 }}>{campaign.createdAt ? formatIndianDate(campaign.createdAt) : "—"}</dd>
              </div>
            </dl>
            <div style={{ display: "flex", gap: 8, padding: 12 }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => setConfirm("send")}
                disabled={!canSend || busy}
              >
                Send
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => setConfirm("cancel")}
                disabled={!canCancel || busy}
              >
                Cancel campaign
              </button>
            </div>
          </>
        )}
      </div>

      {/* ---------------------------------------------------------- metrics -- */}
      <div className="card">
        <div className="card-h">
          <h3>Performance & ROI</h3>
          {metricsSource === "error" ? <DataSourceBadge source="error" /> : null}
        </div>

        {metricsSource === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: "0 12px" }}>
            Loading metrics…
          </p>
        ) : metricsSource === "error" || !metrics ? (
          <EmptyState icon="📊" title="—" message="Metrics could not be loaded. Showing saved information." />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
              padding: 12,
            }}
          >
            <Metric label="Recipients" value={metrics.recipients.toLocaleString("en-IN")} />
            <Metric label="Delivered" value={metrics.delivered.toLocaleString("en-IN")} />
            <Metric label="Failed" value={metrics.failed.toLocaleString("en-IN")} />
            <Metric label="Responses" value={metrics.responses.toLocaleString("en-IN")} />
            <Metric label="Conversions" value={metrics.conversions.toLocaleString("en-IN")} />
            <Metric label="Actual cost" value={formatMoney(metrics.actualCostMinor)} />
            <Metric label="Attributed revenue" value={formatMoney(metrics.attributedRevenueMinor)} />
            <Metric label="ROI" value={formatRoiBps(metrics.roiBps)} emphasis />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        danger={confirm === "cancel"}
        title={confirm === "send" ? "Send this campaign?" : "Cancel this campaign?"}
        description={
          confirm === "send"
            ? "The campaign will be queued and messages will be sent to the audience. This cannot be undone."
            : "The campaign will be cancelled and will not be sent. This cannot be undone."
        }
        confirmLabel={confirm === "send" ? "Send campaign" : "Cancel campaign"}
        cancelLabel="Keep editing"
        busy={busy}
        errorMessage={actionError || undefined}
        onCancel={() => {
          if (!busy) setConfirm(null);
        }}
        onConfirm={() => confirm && void runAction(confirm)}
      />
    </div>
  );
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: emphasis ? 22 : 18, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
