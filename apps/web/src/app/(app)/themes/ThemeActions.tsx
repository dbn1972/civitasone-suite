"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ActionButton } from "@/app/_components/ds";

/**
 * Publishes a new tenant theme revision. Publishing is irreversible — it
 * promotes the revision to every tenant surface — so it is gated behind a
 * ConfirmDialog that requires a change reason (maker-checker).
 */
export function ThemeActions() {
  const router = useRouter();
  const nameId = useId();
  const [name, setName] = useState("Published tenant theme");
  const [status, setStatus] = useState("");

  async function publish(reason?: string) {
    const res = await fetch("/api/proxy/v1/themes/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, reason }),
    });
    if (!res.ok) throw new Error((await res.text()) || "Failed to publish theme revision.");
    setStatus(`Theme revision “${name}” published.`);
    router.refresh();
  }

  const canPublish = name.trim().length > 0;

  return (
    <div className="card">
      <div className="card-h">
        <h3>Publish theme revision</h3>
      </div>
      <div className="pad" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
        <div style={{ flex: "1 1 280px", minWidth: 220 }}>
          <label htmlFor={nameId} style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--ink2, #475569)", marginBottom: 6 }}>
            Revision name
          </label>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Spring 2026 branding"
            style={{
              width: "100%",
              borderRadius: 8,
              border: "1px solid var(--line, #e2e8f0)",
              padding: "10px 12px",
              fontSize: 14,
              minHeight: 44,
            }}
          />
        </div>
        <ActionButton
          label="Publish theme"
          disabled={!canPublish}
          confirmTitle="Publish this theme revision?"
          confirmDescription={
            <>
              This promotes <strong>“{name.trim() || "the revision"}”</strong> to every tenant
              surface and cannot be undone. Provide a reason for the audit trail.
            </>
          }
          confirmLabel="Publish"
          requireReason
          reasonLabel="Reason for publishing"
          onConfirm={publish}
        />
      </div>
      <p role="status" aria-live="polite" style={{ minHeight: 20, margin: "0 16px 16px", fontSize: 13, color: "var(--ink2, #475569)" }}>
        {status}
      </p>
    </div>
  );
}
