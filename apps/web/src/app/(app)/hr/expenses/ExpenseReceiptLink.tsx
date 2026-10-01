"use client";

/**
 * GAP-HR-EXPENSES-04: receiptKey was already in the API response but never
 * shown anywhere, and the API returns an object-storage key, not a URL -- a
 * client component (not a `render:` function prop -- see GAP-HR-EXPENSES-01's
 * root cause) that fetches a short-lived presigned URL on demand and opens
 * it, rather than the page ever holding a direct/permanent link to a
 * possibly-PII-bearing document.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";

export function ExpenseReceiptLink({ id, hasReceipt }: { id: string; hasReceipt: boolean }) {
  const t = useTranslations("expenses");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const formError = useFormError("receipt");

  if (!hasReceipt) {
    return <span style={{ color: "var(--mut)", fontSize: 13 }}>{t("receiptNone")}</span>;
  }

  async function openReceipt() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/expenses/${id}/receipt`);
      if (!res.ok) {
        setError((await formError.fromResponse(res, "load")).message);
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (body.url) {
        // A fresh, short-lived (5 min) signed URL each click -- never stored
        // or reused, and never rendered as a plain <a href> (which would bake
        // today's signature into the page's own markup/cache).
        window.open(body.url, "_blank", "noopener,noreferrer");
      }
    } catch {
      setError(formError.fromException("load").message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={openReceipt}
        disabled={busy}
        className="link-button"
        style={{ background: "none", border: "none", padding: 0, color: "var(--accent, #2563eb)", textDecoration: "underline", cursor: busy ? "default" : "pointer", fontSize: 13 }}
      >
        {busy ? t("receiptLoading") : t("receiptView")}
      </button>
      {error && <p role="alert" style={{ color: "var(--bad, #b91c1c)", fontSize: 12, margin: "2px 0 0" }}>{error}</p>}
    </div>
  );
}
