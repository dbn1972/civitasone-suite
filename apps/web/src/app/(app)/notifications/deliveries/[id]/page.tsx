"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageHeader, Card, EmptyState } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { StatusBadge } from "../../_components/StatusBadge";
import { ResendAction } from "./ResendAction";

/**
 * Delivery detail — GET /notification/deliveries/:id returns the raw delivery
 * row from notification-service (deliveries.deliveries). Shows delivery status,
 * attempt count, the next scheduled retry, and the failure reason for failed
 * deliveries. Failed deliveries expose a "Resend" action that re-triggers a
 * send via POST /notification/send (the service has no per-delivery retry
 * endpoint — the SQS sweeper owns automatic retries — so this honestly issues a
 * fresh send for the same template + recipient rather than faking a retry).
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
  nextRetryAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prefrow" style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <span style={{ fontSize: 12, color: "#667085" }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: "right", wordBreak: "break-word" }}>{children}</span>
    </div>
  );
}

export default function DeliveryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    if (!id) return;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/proxy/notification/deliveries/${id}`, {
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
        });
        if (res.status === 404) {
          setDelivery(null);
          setError("not_found");
          return;
        }
        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        setDelivery((await res.json()) as Delivery);
      } catch (err) {
        setError(err instanceof Error ? err.message : "load failed");
      } finally {
        setLoading(false);
      }
    })();
  }

  useEffect(load, [id]);

  if (loading) {
    return (
      <>
        <PageHeader title="Delivery" subtitle="Loading delivery details…" back="/notifications/deliveries" />
        <Card padding>
          <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#667085" }}>
            Loading delivery details…
          </p>
        </Card>
      </>
    );
  }

  if (error === "not_found" || !delivery) {
    return (
      <>
        <PageHeader title="Delivery" back="/notifications/deliveries" />
        <Card padding>
          <EmptyState
            icon="📭"
            title={error && error !== "not_found" ? "Couldn't load this delivery" : "Delivery not found"}
            message={
              error && error !== "not_found"
                ? "There was a problem loading this delivery. Please try again."
                : "This delivery record does not exist or is not visible to your tenant."
            }
            action={
              error && error !== "not_found" ? (
                <button type="button" className="btn primary" onClick={load}>Try again</button>
              ) : (
                <a className="btn ghost" href="/notifications/deliveries">Back to deliveries</a>
              )
            }
          />
        </Card>
      </>
    );
  }

  const isFailed = delivery.status === "failed" || delivery.status === "bounced";

  return (
    <>
      <PageHeader
        title="Delivery detail"
        subtitle="Delivery status, attempts and failure log for a single notification."
        back="/notifications/deliveries"
        actions={
          isFailed ? (
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
          <Row label="Recipient">{delivery.recipient}</Row>
          <Row label="Channel">{delivery.channel.replace(/_/g, " ")}</Row>
          <Row label="Attempts">{delivery.retryCount ?? 0}</Row>
          <Row label="Sent at">{delivery.sentAt ? formatIndianDate(delivery.sentAt) : "—"}</Row>
          <Row label="Next retry at">{delivery.nextRetryAt ? formatIndianDate(delivery.nextRetryAt) : "—"}</Row>
          <Row label="Created at">{delivery.createdAt ? formatIndianDate(delivery.createdAt) : "—"}</Row>
        </Card>

        <Card title="Diagnostics" padding>
          <Row label="Delivery ID"><span className="mono">{delivery.id}</span></Row>
          <Row label="Template ID"><span className="mono">{delivery.templateId}</span></Row>
          {isFailed ? (
            <>
              <Row label="Failure reason">{delivery.error ?? "Not recorded"}</Row>
              {delivery.errorDetail ? <Row label="Detail">{delivery.errorDetail}</Row> : null}
            </>
          ) : (
            <p style={{ fontSize: 12, color: "#667085", marginTop: 8 }}>No errors recorded for this delivery.</p>
          )}
        </Card>
      </div>
    </>
  );
}
