"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/_components/ds/Toast";

interface ApprovalFinalizeButtonProps {
  id: string;
  type: "aa" | "ts";
  status: string;
}

const FINALIZED_STATUSES = new Set(["finalized", "approved", "published"]);

export function ApprovalFinalizeButton({
  id,
  type,
  status,
}: ApprovalFinalizeButtonProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(FINALIZED_STATUSES.has(status));

  if (done) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 16px",
          borderRadius: 8,
          background: "#ecfdf3",
          color: "#166534",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        ✓ Finalized
      </span>
    );
  }

  async function handleFinalize() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/proxy/v1/works/approvals/${type}/${id}/finalize`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(
          (data as { message?: string }).message ??
            `Finalize failed (${res.status})`,
        );
        return;
      }
      toast.success(
        type === "aa"
          ? "Administrative Approval finalized."
          : "Technical Sanction finalized.",
      );
      setDone(true);
      setTimeout(() => router.refresh(), 800);
    } catch {
      toast.error("Network error — could not finalize.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleFinalize}
      disabled={busy}
      style={{
        padding: "8px 20px",
        borderRadius: 8,
        background: "var(--accent)",
        color: "#fff",
        border: "none",
        fontWeight: 600,
        fontSize: 14,
        cursor: busy ? "not-allowed" : "pointer",
        opacity: busy ? 0.7 : 1,
      }}
    >
      {busy ? "Finalizing…" : type === "aa" ? "Finalize AA" : "Finalize TS"}
    </button>
  );
}
