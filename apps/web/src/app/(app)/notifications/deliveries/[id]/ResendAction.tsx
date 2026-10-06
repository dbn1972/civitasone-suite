"use client";

import { useState } from "react";
import { ActionButton } from "../../../../_components/ds";
import { toHumanError } from "@/lib/messages";

/**
 * Plain-language failure message for a failed resend. `resend` is a plain
 * async helper, not a component or hook, so it can't call the useFormError
 * hook; toHumanError is the same catalogued-message building block that hook
 * is built on -- never the backend's own message/error text or the raw HTTP
 * status. See docs/ENTERPRISE-GAP-REPORT-2026-09-07.md UX-003/UX-016.
 */
function resendActionError(): string {
  const human = toHumanError("save", { area: "notification" });
  return `${human.what} ${human.next}`;
}

/**
 * Resend a failed delivery. The notification-service has no per-delivery HTTP
 * retry endpoint (automatic retries are owned by the SQS sweeper), so this
 * honestly issues a fresh send for the same template + recipient via
 * POST /notification/send. The action is gated behind the DS ConfirmDialog
 * (maker-checker) and announces the result through a polite aria-live region.
 *
 * GAP-NOTIFICATIONS-DELIVERIES-DETAIL-01: this re-send carries only
 * templateId + recipient + channel — it does NOT re-send the original rendered
 * payload/variables (the delivery row doesn't store them), so a template with
 * {{placeholders}} would be re-rendered with the service's defaults. The
 * confirm dialog says so honestly rather than silently sending blanks. The
 * button itself is shown only to roles that may send (resolved in page.tsx);
 * the service's send route stays the authority.
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
  const [done, setDone] = useState(false);

  const channelEnum =
    channel === "in_app" || channel === "email" || channel === "sms" || channel === "push" || channel === "whatsapp"
      ? channel
      : undefined;

  async function resend() {
    const res = await fetch(`/api/proxy/notification/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId, recipient, ...(channelEnum ? { channel: channelEnum } : {}) }),
    });
    if (!res.ok) {
      throw new Error(resendActionError());
    }
  }

  return (
    <>
      <ActionButton
        label="Resend"
        confirmTitle="Resend this notification?"
        confirmDescription={
          <>
            This issues a fresh send of the same template to this recipient. The original failed
            delivery is left unchanged for audit, and a new delivery is created. If the template has
            fill-in fields, they are re-filled with the template&apos;s default values (the original
            values aren&apos;t stored on the delivery).
          </>
        }
        confirmLabel="Resend"
        onConfirm={resend}
        onSuccess={() => {
          setDone(true);
          onResent?.();
        }}
      />
      {done ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647", margin: "8px 0 0" }}>
          Resend queued. The new delivery will appear in{" "}
          <a href="/notifications/deliveries">Deliveries</a> once the send is processed.
        </p>
      ) : null}
    </>
  );
}
