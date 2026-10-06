"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Button, Card } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

// GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-01: mirrors the notification-service
// createChannelBody EXACTLY (type, name, isDefault, enabled). The service's
// channel model has no provider/config/status fields, so the form never
// collects or sends them (an earlier UI "How to configure" snippet showed a
// provider/config body the backend does not accept).
const channelType = z.enum(["email", "sms", "push", "in_app", "whatsapp"]);
const formSchema = z.object({
  name: z.string().trim().min(1, "Enter a channel name").max(128),
  type: channelType,
  isDefault: z.boolean(),
  enabled: z.boolean(),
});

const TYPE_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  push: "Push notification",
  in_app: "In-app",
  whatsapp: "WhatsApp",
};

export function ChannelForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("email");
  const [isDefault, setIsDefault] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [fieldError, setFieldError] = useState("");
  const formError = useFormError("channel");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("");
    setError("");
    setFieldError("");
    formError.clear();

    const parsed = formSchema.safeParse({ name, type, isDefault, enabled });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Please check the form");
      return; // GAP-CHANNELS-01: invalid form sends no request
    }

    setBusy(true);
    try {
      const res = await fetch("/api/proxy/notification/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setStatus("Channel added.");
      setName("");
      setType("email");
      setIsDefault(false);
      setEnabled(true);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Add a channel" padding>
      <form onSubmit={submit} aria-label="Add notification channel" style={{ display: "grid", gap: 12, maxWidth: 420 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span>Channel name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Office email"
            aria-invalid={fieldError ? true : undefined}
            style={{ minHeight: 40, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 8 }}
          />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <span>Delivery type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ minHeight: 40, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
            {Object.entries(TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "center" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Enabled</span>
        </label>
        <label style={{ display: "flex", gap: 8, fontSize: 13, alignItems: "center" }}>
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          <span>Use as the default for this delivery type</span>
        </label>

        {fieldError && <p role="alert" style={{ fontSize: 12, color: "var(--bad)", margin: 0 }}>{fieldError}</p>}
        {error && <p role="alert" style={{ fontSize: 12, color: "var(--bad)", margin: 0 }}>{error}</p>}
        <div role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647" }}>{status}</div>

        <div>
          <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? "Adding…" : "Add channel"}</Button>
        </div>
      </form>
    </Card>
  );
}
