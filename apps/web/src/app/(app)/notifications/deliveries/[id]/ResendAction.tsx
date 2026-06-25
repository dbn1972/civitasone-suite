"use client";

import { useState } from "react";
import { ActionButton } from "../../../../_components/ds";

/**
 * Resend a failed delivery. The notification-service has no per-delivery HTTP
 * retry endpoint (automatic retries are owned by the SQS sweeper), so this
 * honestly issues a fresh send for the same template + recipient via
 * POST /notification/send. The action is gated behind the DS ConfirmDialog
 * (maker-checker) and announces the result through a polite aria-live region.
 */
export function ResendAction({
  templateId,
  recipient,
  channel,
  onResent,
}: {
  templateId: string;
  recipient: string;
  channel: string;
  onResent?: () => void;
}) {
  const [result, setResult] = useState<string>("");

  const channelEnum =
    channel === "in_app" || channel === "email" || channel === "sms" || channel === "push" || channel === "whatsapp"
      ? channel
      : undefined;

  async function resend() {
    setResult("");
    const res = await fetch(`/api/proxy/notification/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId, recipient, ...(channelEnum ? { channel: channelEnum } : {}) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Resend failed (HTTP ${res.status})`);
    }
  }

  return (
    <>
      <ActionButton
        label="Resend"
        confirmTitle="Resend this notification?"
        confirmDescription={
          <>
            This issues a fresh send of the same template to <strong>{recipient}</strong>. The original
            failed delivery is left unchanged for audit. The service queues the new send asynchronously.
          </>
        }
        confirmLabel="Resend"
        onConfirm={resend}
        onSuccess={() => {
          setResult("Resend queued. A new delivery will appear once the send is processed.");
          onResent?.();
        }}
      />
      <span role="status" aria-live="polite" className="sr-only">{result}</span>
      {result ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647", margin: "8px 0 0" }}>
          {result}
        </p>
      ) : null}
    </>
  );
}
