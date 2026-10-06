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
import { useEffect, useId, useRef, useState } from "react";
import { Button, ConfirmDialog, ErrorState } from "@/app/_components/ds";
import { StatusBadge } from "../../_components/StatusBadge";
import { formatMoney, formatIndianDateTime } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { useFormError } from "@/lib/useFormError";
import {
  getCampaign,
  getCampaignMetrics,
  getCampaignSegments,
  sendCampaign,
  cancelCampaign,
  campaignStatusLabel,
  formatRoiBps,
  type Campaign,
  type CampaignMetrics,
  type CampaignSegment,
  type Source,
} from "@/lib/notifications/campaigns";

type LoadSource = Source | "loading";
type Action = "send" | "cancel";

/**
 * CampaignDetail. `canManage` reflects whether the signed-in user holds a
 * notification campaign-admin role (NOTIFICATION_SEND_ROLES, resolved server-
 * side in the page wrapper). It mirrors the service's own gate — campaign
 * send/cancel is restricted to platform_admin/super_admin/tenant_admin
 * (bulk/routes.ts requireRole(ADMIN)); the server stays the authority and
 * 403s others, so this only decides whether the UI offers the controls at
 * all (GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-01). Defaults false (fail closed).
 */
export function CampaignDetail({ campaignId, canManage = false }: { campaignId: string; canManage?: boolean }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [campaignSource, setCampaignSource] = useState<LoadSource>("loading");
  const [campaignNotFound, setCampaignNotFound] = useState(false);
  const [metrics, setMetrics] = useState<CampaignMetrics | null>(null);
  const [metricsSource, setMetricsSource] = useState<LoadSource>("loading");
  const [segments, setSegments] = useState<CampaignSegment[]>([]);

  const [confirm, setConfirm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const formError = useFormError("campaign");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");

  const sendHintId = useId();
  const cancelHintId = useId();

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
    const { data, source, notFound } = await getCampaign(campaignId);
    if (!isLive()) return;
    setCampaign(data);
    setCampaignNotFound(Boolean(notFound));
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
    // Segment names for the Audience segment row (GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-05):
    // a failed lookup falls back to the raw id, so this load is best-effort.
    void (async () => {
      const { data } = await getCampaignSegments();
      if (live) setSegments(data);
    })();
    return () => {
      live = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loadCampaign/loadMetrics are redefined each render but only close over campaignId, already listed here.
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
      setActionError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  const status = campaign?.status ?? "";
  // GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-04: only draft/scheduled campaigns can be
  // sent or cancelled from here. The backend cancel command sets status
  // "cancelled" from ANY state (bulk/consumer.ts) with no "stop a mid-send"
  // semantics, so cancelling a "sending" campaign would NOT recall messages
  // already handed to the provider — it would only mislabel the row. Until the
  // service exposes a real stop/abort, we do not offer Cancel while sending
  // (safest default: fail closed; recorded for HUMAN REVIEW).
  const manageable = status === "draft" || status === "scheduled";
  const canSend = campaignSource === "api" && canManage && manageable;
  const canCancel = campaignSource === "api" && canManage && manageable;
  // Why a rendered-but-disabled Send is disabled, surfaced via aria-describedby.
  const sendDisabledReason = !canManage
    ? "Only a notification administrator can send campaigns."
    : !manageable
      ? "Only draft or scheduled campaigns can be sent."
      : "";
  const cancelDisabledReason = !canManage
    ? "Only a notification administrator can cancel campaigns."
    : !manageable
      ? status === "sending"
        ? "Messages already being sent cannot be recalled."
        : "Only draft or scheduled campaigns can be cancelled."
      : "";

  // GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-05: show the segment NAME, not the raw id,
  // falling back to the id when the lookup didn't resolve it.
  const segmentDisplay = campaign?.audienceSegmentId
    ? (segments.find((s) => s.id === campaign.audienceSegmentId)?.name ?? campaign.audienceSegmentId)
    : "—";

  // GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-05: before a first send a draft/scheduled
  // campaign has no real metrics — zeros here read as failure, not "not started".
  const metricsNotStarted =
    metricsSource === "api" && (status === "draft" || status === "scheduled") && (metrics?.recipients ?? 0) === 0;

  // GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-01: show the audience size in the Send
  // confirm so the admin sees the blast radius before an irreversible mass send.
  const audienceCount = metrics?.recipients;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ----------------------------------------------------------- fields -- */}
      <div className="card">
        <div className="card-h">
          <h3>Campaign</h3>
        </div>

        {message ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--good)", padding: "0 12px" }}>
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
        ) : campaignNotFound ? (
          // 404: an unknown id is a dead end, not a transient failure — no Retry,
          // just an honest "not found" with a way back to the list.
          <ErrorState
            error={{
              what: "Campaign not found.",
              next: "It may have been removed, or the link may be wrong.",
              actions: ["back"],
            }}
            backHref="/notifications/campaigns"
          />
        ) : campaignSource === "error" || !campaign ? (
          // Transient load failure: honest copy + Retry, never "showing saved
          // information" (nothing is cached). GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-02.
          <ErrorState
            error={toHumanError("load", { area: "the campaign" })}
            onRetry={() => void loadCampaign(() => mountedRef.current)}
            backHref="/notifications/campaigns"
          />
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
                <dd style={{ margin: 0, fontSize: 14 }}>{segmentDisplay}</dd>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <dt style={{ minWidth: 160, color: "var(--muted)", fontSize: 13, margin: 0 }}>Scheduled at</dt>
                <dd style={{ margin: 0, fontSize: 14 }}>{campaign.scheduledAt ? formatIndianDateTime(campaign.scheduledAt) : "—"}</dd>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <dt style={{ minWidth: 160, color: "var(--muted)", fontSize: 13, margin: 0 }}>Created</dt>
                <dd style={{ margin: 0, fontSize: 14 }}>{campaign.createdAt ? formatIndianDateTime(campaign.createdAt) : "—"}</dd>
              </div>
            </dl>
            {/* Only render the action bar for a user who can manage; a plain
                viewer sees no disabled controls at all. When managing, buttons
                stay rendered-but-disabled with an explanation (DETAIL-04). */}
            {canManage ? (
              <div style={{ display: "grid", gap: 6, padding: 12 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button onClick={() => setConfirm("send")} disabled={!canSend || busy} aria-describedby={sendDisabledReason ? sendHintId : undefined}>
                    Send
                  </Button>
                  <Button variant="danger" onClick={() => setConfirm("cancel")} disabled={!canCancel || busy} aria-describedby={cancelDisabledReason ? cancelHintId : undefined}>
                    Cancel campaign
                  </Button>
                </div>
                {sendDisabledReason || cancelDisabledReason ? (
                  <div style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
                    {sendDisabledReason ? <p id={sendHintId} style={{ margin: 0 }}>{sendDisabledReason}</p> : null}
                    {cancelDisabledReason && (cancelDisabledReason as string) !== (sendDisabledReason as string) ? (
                      <p id={cancelHintId} style={{ margin: 0 }}>{cancelDisabledReason}</p>
                    ) : (
                      <span id={cancelHintId} className="sr-only">{cancelDisabledReason}</span>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* ---------------------------------------------------------- metrics -- */}
      <div className="card">
        <div className="card-h">
          <h3>Performance &amp; ROI</h3>
        </div>

        {metricsSource === "loading" ? (
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "var(--muted)", padding: "0 12px" }}>
            Loading metrics…
          </p>
        ) : metricsSource === "error" || !metrics ? (
          <ErrorState
            error={toHumanError("load", { area: "campaign metrics" })}
            onRetry={() => void loadMetrics(() => mountedRef.current)}
          />
        ) : metricsNotStarted ? (
          <p style={{ fontSize: 13, color: "var(--muted)", padding: 12, margin: 0 }}>
            Metrics appear after the first send. This campaign has not been sent yet.
          </p>
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
            <Metric
              label="ROI"
              value={formatRoiBps(metrics.roiBps)}
              emphasis
              hint={metrics.roiBps === null ? "Not available until a cost is recorded" : undefined}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        danger={confirm === "cancel"}
        title={confirm === "send" ? "Send this campaign?" : "Cancel this campaign?"}
        description={
          confirm === "send"
            ? `Messages will be queued and sent to the audience${
                typeof audienceCount === "number" ? ` (${audienceCount.toLocaleString("en-IN")} recipient${audienceCount === 1 ? "" : "s"})` : ""
              }. Recipients who have opted out or set Do-Not-Disturb are skipped automatically. This cannot be undone.`
            : "The campaign will be cancelled and will not be sent. This cannot be undone."
        }
        confirmLabel={confirm === "send" ? "Send campaign" : "Cancel campaign"}
        cancelLabel="Go back"
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

function Metric({ label, value, emphasis, hint }: { label: string; value: string; emphasis?: boolean; hint?: string }) {
  return (
    <div className="card" style={{ padding: 12 }} title={hint}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: emphasis ? 22 : 18, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
