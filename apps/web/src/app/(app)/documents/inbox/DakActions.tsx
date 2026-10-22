"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ActionButton, Field, Input } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * Acknowledge / Forward controls for a single dak (GAP-DOCUMENTS-INBOX-01).
 * Each posts to the confirmed document-service workflow endpoint and then
 * refreshes the server component so the new status is read back from the DB;
 * the audit trail is written server-side in the workflow consumer.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function DakActions({ dakId, status }: { dakId: string; status: string }) {
  const t = useTranslations("documentsDak");
  const router = useRouter();
  const formError = useFormError("dak");
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState("");
  const alreadyAcknowledged = status === "acknowledged";
  const assigneeId = assignee.trim();
  const assigneeInvalid = assigneeId !== "" && !UUID_RE.test(assigneeId);

  async function post(path: string, body?: unknown): Promise<void> {
    setError(null);
    const res = await fetch(`/api/proxy/v1/documents/daks/${encodeURIComponent(dakId)}/${path}`, {
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
    <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
      <ActionButton
        label={alreadyAcknowledged ? t("acknowledged") : t("acknowledge")}
        disabled={alreadyAcknowledged}
        confirmTitle={t("ackTitle")}
        confirmDescription={t("ackDescription")}
        confirmLabel={t("acknowledge")}
        onConfirm={() => post("acknowledge")}
      />
      <Field label={t("assigneeLabel")} error={assigneeInvalid ? t("assigneeInvalid") : undefined}>
        <Input
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          placeholder={t("assigneeHint")}
          autoComplete="off"
          spellCheck={false}
          maxLength={36}
        />
      </Field>
      <ActionButton
        label={t("forward")}
        className="btn"
        disabled={assigneeId === "" || assigneeInvalid}
        confirmTitle={t("forwardTitle")}
        confirmDescription={t("forwardDescription")}
        confirmLabel={t("forward")}
        onConfirm={() => post("forward", { assignedTo: assigneeId })}
      />
      {error && (
        <span role="alert" style={{ color: "var(--bad)", fontSize: 13 }}>{error}</span>
      )}
    </div>
  );
}
