"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button, PageHeader, Card, EmptyState } from "../../../../_components/ds";
import { formatIndianDateTime, maskRecipient } from "@/lib/formatters";
import { StatusBadge } from "../../_components/StatusBadge";
import { ResendAction } from "./ResendAction";
import { useFormError } from "@/lib/useFormError";

/**
 * Delivery detail — GET /notification/deliveries/:id returns the raw delivery
 * row from notification-service (deliveries.deliveries). Shows delivery status,
 * attempt count, the next scheduled retry, and the failure reason for failed
 * deliveries. Failed deliveries expose a "Resend" action that re-triggers a
 * send via POST /notification/send (the service has no per-delivery retry
 * endpoint — the SQS sweeper owns automatic retries — so this honestly issues a
 * fresh send for the same template + recipient rather than faking a retry).
 *
 * Role capabilities (`canResend`, `canSeeTechnicalDetail`) are resolved
 * server-side in page.tsx (getSessionRoles) and passed in; the notification
 * service remains the authority (403 on send / read).
 */
type Delivery = {
  id: string;
  tenantId?: string;
  templateId: string;
  recipient: string;
  recipientId?: string | null;
  channel: string;
  status: string;
  sentAt?: string | null;
  error?: string | null;
  errorDetail?: string | null;
  retryCount?: number;
  attemptCount?: number;
  nextRetryAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * DELIVERIES-DETAIL-03: map a provider/backend error string to a catalogued,
 * clerk-safe reason. The raw provider text (which can carry gateway internals)
 * is shown only under a collapsible "Technical detail" for admins. Unknown
 * codes fall back to a generic honest line, never the raw string.
 */
const FAILURE_REASONS: Record<string, string> = {
  DLT_TEMPLATE_NOT_REGISTERED: "The SMS/WhatsApp template isn't registered with the DLT operator.",
  CHANNEL_QUOTA_EXHAUSTED: "The daily sending quota for this channel is used up.",
  BOUNCED: "The recipient address rejected the message.",
  INVALID_RECIPIENT: "The recipient address isn't valid for this channel.",
  PROVIDER_ERROR: "The messaging provider couldn't deliver this message.",
};
function friendlyFailure(error: string | null | undefined): string {
  if (!error) return "Not recorded";
  const key = error.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return FAILURE_REASONS[key] ?? "This message couldn't be delivered.";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prefrow" style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontSize: 12, color: "#667085" }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: "right", wordBreak: "break-word" }}>{children}</span>
    </div>
  );
}

export function DeliveryDetail({
  canResend,
  canSeeTechnicalDetail,
}: {
  canResend: boolean;
  canSeeTechnicalDetail: boolean;
}) {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  // DETAIL-05: split not-found / forbidden / generic error into distinct state
  // and render the resolved message rather than one fixed sentence.
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formError = useFormError("delivery");

  function load() {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    setForbidden(false);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/proxy/notification/deliveries/${id}`, {
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
        });
        if (res.status === 404) {
          setDelivery(null);
          setNotFound(true);
          return;
        }
        if (res.status === 403) {
          setDelivery(null);
          setForbidden(true);
          return;
        }
        if (!res.ok) {
          const resolved = await formError.fromResponse(res, "load");
          setError(resolved.message);
          return;
        }
        setDelivery((await res.json()) as Delivery);
      } catch (caught) {
        setError(formError.fromException("load", caught).message);
      } finally {
        setLoading(false);
      }
    })();
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- formError.* are stable (useCallback'd on a fixed area); the wrapping object isn't read here.
  useEffect(load, [id]);

  if (loading) {
    return (
      <>
        <PageHeader title="Delivery" subtitle="Loading delivery details…" back="/notifications/deliveries" backLabel="Deliveries" />
        <Card padding>
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#667085" }}>
            Loading delivery details…
          </p>
        </Card>
      </>
    );
  }

  if (notFound || forbidden || error || !delivery) {
    const title = notFound ? "Delivery not found" : forbidden ? "You don't have access" : "Couldn't load this delivery";
    const message = notFound
      ? "This delivery record does not exist or is not visible to your tenant."
      : forbidden
        ? "You don't have permission to view this delivery. Ask an administrator if you need access."
        : (error ?? "There was a problem loading this delivery.");
    return (
      <>
        <PageHeader title="Delivery" back="/notifications/deliveries" backLabel="Deliveries" />
        <Card padding>
          <EmptyState
            icon={notFound ? "📭" : forbidden ? "🔒" : "⚠️"}
            title={title}
            message={message}
            action={
              notFound || forbidden ? (
                <a className="btn ghost" href="/notifications/deliveries">Back to deliveries</a>
              ) : (
                <Button onClick={load}>Try again</Button>
              )
            }
          />
        </Card>
      </>
    );
  }

  const isFailed = delivery.status === "failed" || delivery.status === "bounced";
  // DETAIL-04: list uses attemptCount, detail historically read retryCount only.
  // Show the first field present; "—" when neither exists (never a fabricated 0).
  const attempts =
    delivery.retryCount ?? delivery.attemptCount ?? null;

  return (
    <>
      <PageHeader
        title="Delivery detail"
        subtitle="Delivery status, attempts and failure log for a single notification."
        back="/notifications/deliveries"
        backLabel="Deliveries"
        actions={
          isFailed && canResend ? (
            <ResendAction
              templateId={delivery.templateId}
              recipient={delivery.recipient}
              channel={delivery.channel}
              onResent={load}
            />
          ) : undefined
        }
      />

      <div className="grid g-main" style={{ marginTop: 18 }}>
        <Card title="Delivery" padding>
          <Row label="Status"><StatusBadge status={delivery.status} /></Row>
          {/* DETAIL-02 (DPDP): recipient masked by default; no audited reveal endpoint exists. */}
          <Row label="Recipient">
            <span className="mono" aria-label="Recipient (masked)">{maskRecipient(delivery.recipient)}</span>
          </Row>
          <Row label="Channel">{delivery.channel.replace(/_/g, " ")}</Row>
          <Row label="Attempts">{attempts ?? "—"}</Row>
          <Row label="Sent at">{delivery.sentAt ? formatIndianDateTime(delivery.sentAt) : "—"}</Row>
          <Row label="Next retry at">{delivery.nextRetryAt ? formatIndianDateTime(delivery.nextRetryAt) : "—"}</Row>
          <Row label="Created at">{delivery.createdAt ? formatIndianDateTime(delivery.createdAt) : "—"}</Row>
        </Card>

        <Card title="Diagnostics" padding>
          <Row label="Reference"><span className="mono">{delivery.id}</span></Row>
          {/* DETAIL-03: template id links to the template detail page. */}
          <Row label="Template">
            <a className="mono" href={`/notifications/templates/${delivery.templateId}`}>{delivery.templateId}</a>
          </Row>
          {isFailed ? (
            <>
              <Row label="Failure reason">{friendlyFailure(delivery.error)}</Row>
              {canSeeTechnicalDetail && (delivery.error || delivery.errorDetail) ? (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 12, color: "#667085", cursor: "pointer" }}>Technical detail</summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12, marginTop: 6 }}>
                    {[delivery.error, delivery.errorDetail].filter(Boolean).join("\n")}
                  </pre>
                </details>
              ) : null}
            </>
          ) : (
            <p style={{ fontSize: 12, color: "#667085", marginTop: 8 }}>No errors recorded for this delivery.</p>
          )}
        </Card>
      </div>
    </>
  );
}
