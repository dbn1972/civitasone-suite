"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * Acknowledge / Forward controls for a single dak (GAP-DOCUMENTS-INBOX-01).
 * Each posts to the confirmed document-service workflow endpoint and then
 * refreshes the server component so the new status is read back from the DB;
 * the audit trail is written server-side in the workflow consumer.
 */
export function DakActions({ dakId, status }: { dakId: string; status: string }) {
  const router = useRouter();
  const formError = useFormError("dak");
  const [error, setError] = useState<string | null>(null);
  const alreadyAcknowledged = status === "acknowledged";

  async function post(path: string, body?: unknown): Promise<void> {
    setError(null);
    const res = await fetch(`/api/v1/documents/daks/${encodeURIComponent(dakId)}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const human = await formError.fromResponse(res, "save");
      setError(human.message);
      throw new Error(human.message);
    }
    router.refresh();
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <ActionButton
        label={alreadyAcknowledged ? "Acknowledged" : "Acknowledge"}
        disabled={alreadyAcknowledged}
        confirmTitle="Acknowledge this dak?"
        confirmDescription="This records that you have received and seen this dak. It cannot be undone."
        confirmLabel="Acknowledge"
        onConfirm={() => post("acknowledge")}
      />
      <ActionButton
        label="Forward"
        className="btn"
        confirmTitle="Forward this dak"
        confirmDescription="Enter the user ID of the person to assign this dak to."
        confirmLabel="Forward"
        requireReason
        reasonLabel="Assign to (user ID)"
        onConfirm={(reason?: string) => post("forward", { assignedTo: (reason ?? "").trim() })}
      />
      {error && (
        <span role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{error}</span>
      )}
    </div>
  );
}
