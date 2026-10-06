"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { ActionButton } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

/**
 * Publishes a new tenant theme revision. Publishing is irreversible — it
 * promotes the revision to every tenant surface — so it is gated behind a
 * ConfirmDialog that requires a change reason (maker-checker). The theme-service
 * publish route additionally enforces an admin role and maker != checker, and
 * writes an audit event with the reason (the server remains the authority).
 */
export function ThemeActions({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const nameId = useId();
  // GAP-THEMES-TOKENS-07: a dated default ("Theme 29 Sep 2026") rather than the
  // same constant "Published tenant theme" every time, so successive revisions
  // are distinguishable in history.
  const defaultName = useMemo(() => `Theme ${formatIndianDate(new Date().toISOString())}`, []);
  const [name, setName] = useState(defaultName);
  const [status, setStatus] = useState("");

  async function publish(reason?: string) {
    const res = await fetch("/api/proxy/v1/themes/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, reason }),
    });
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
    const body = (await res.json().catch(() => null)) as { version?: number; publishedAt?: string } | null;
    const versionNote = body?.version ? ` (v${body.version})` : "";
    setStatus(`Theme revision “${name}”${versionNote} published.`);
    router.refresh();
  }

  const canPublish = !disabled && name.trim().length > 0;

  return (
    <div className="card">
      <div className="card-h">
        <h3>Publish theme revision</h3>
      </div>
      <div className="pad" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
        <div className="field" style={{ flex: "1 1 280px", minWidth: 220 }}>
          <label className="label" htmlFor={nameId}>Revision name</label>
          <input
            id={nameId}
            className="inp"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (status) setStatus("");
            }}
            placeholder="e.g. Spring 2026 branding"
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
      <p role="status" aria-live="polite" className="pad" style={{ minHeight: 20, paddingTop: 0, fontSize: 13 }}>
        {status}
      </p>
    </div>
  );
}
