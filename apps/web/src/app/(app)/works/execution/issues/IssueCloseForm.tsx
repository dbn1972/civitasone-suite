"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/_components/ds";
import { useToast } from "@/app/_components/ds/Toast";
import { useFormError } from "@/lib/useFormError";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 8,
  minHeight: 44,
  borderRadius: 8,
  border: "1px solid var(--line)",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "var(--muted)",
  marginBottom: 4,
  fontWeight: 600,
};

export function IssueCloseForm() {
  const router = useRouter();
  const { toast } = useToast();

  const [issueId, setIssueId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formError = useFormError("issue");

  async function handleConfirm() {
    setError(null);
    setBusy(true);
    formError.clear();

    try {
      const res = await fetch(
        `/api/proxy/v1/works/execution/issues/${issueId}/close`,
        { method: "POST" }
      );

      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        setBusy(false);
        return;
      }

      setDialogOpen(false);
      toast.success("Issue closed.");
      setIssueId("");
      setTimeout(() => router.refresh(), 600);
    } catch {
      setError(formError.fromException("save").message);
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
        Enter an issue UUID to mark it as resolved.
      </p>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle} htmlFor="close-issue-id">
          Issue ID *
        </label>
        <input
          id="close-issue-id"
          style={inputStyle}
          type="text"
          value={issueId}
          onChange={(e) => setIssueId(e.target.value)}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
      </div>

      <button
        type="button"
        disabled={!issueId.trim()}
        onClick={() => {
          setError(null);
          setDialogOpen(true);
        }}
        style={{
          padding: "10px 24px",
          borderRadius: 8,
          border: "none",
          background: "var(--accent)",
          color: "#fff",
          fontWeight: 600,
          fontSize: 14,
          cursor: !issueId.trim() ? "not-allowed" : "pointer",
          opacity: !issueId.trim() ? 0.5 : 1,
        }}
      >
        Close Issue
      </button>

      <ConfirmDialog
        open={dialogOpen}
        title="Close Issue"
        description="This marks the issue as resolved."
        confirmLabel="Close Issue"
        cancelLabel="Cancel"
        danger
        busy={busy}
        errorMessage={error ?? undefined}
        onConfirm={handleConfirm}
        onCancel={() => setDialogOpen(false)}
      />
    </div>
  );
}
