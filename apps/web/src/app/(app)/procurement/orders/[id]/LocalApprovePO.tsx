"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import { browserFetch } from "@/lib/api/browserClient";

/**
 * M10: procurement without Finance. For a tenant in local approval mode (no
 * Finance module) a draft or pending purchase order is approved here, under the
 * approval-limit matrix, by a procurement approver other than its creator. For
 * every other tenant this renders nothing, so the PO page is exactly as it was.
 */
export function LocalApprovePO({ poId, status, canApproveRole }: { poId: string; status: string; canApproveRole: boolean }) {
  const [local, setLocal] = useState(false);

  useEffect(() => {
    if (!canApproveRole || (status !== "draft" && status !== "pending")) return;
    let live = true;
    void (async () => {
      try {
        const res = await browserFetch("v1/procurement/po-approval-settings");
        if (!res.ok) return;
        const body = (await res.json()) as { mode?: unknown };
        if (live && body.mode === "local") setLocal(true);
      } catch {
        /* unknown mode: stay hidden, the workflow approval is unaffected */
      }
    })();
    return () => { live = false; };
  }, [canApproveRole, status]);

  if (!local || !canApproveRole || (status !== "draft" && status !== "pending")) return null;
  return <LocalApproveAction poId={poId} />;
}

// Split from the gate above so a tenant on the finance-sanction path renders (and translates) nothing at all.
function LocalApproveAction({ poId }: { poId: string }) {
  const t = useTranslations("poLocalApproval");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  async function approve(reason?: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserFetch(`v1/procurement/pos/${encodeURIComponent(poId)}/approve`, {
        method: "PATCH",
        body: JSON.stringify(reason && reason.trim().length >= 3 ? { reason: reason.trim() } : {}),
      });
      if (!res.ok) {
        let message = t("networkError");
        try {
          const body = (await res.json()) as { code?: string; message?: string };
          message = body.code === "SOD_VIOLATION" ? t("selfApprovalError") : (body.message ?? message);
        } catch { /* keep the generic message */ }
        setError(message);
        return;
      }
      setOpen(false);
      setDone(true);
      router.refresh();
    } catch {
      setError(t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p role="status" className="pill good" style={{ margin: 0, width: "fit-content" }}>{t("approvedMessage")}</p>;

  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
      <Button type="button" style={{ minHeight: 44 }} onClick={() => { setError(undefined); setOpen(true); }}>{t("approveBtn")}</Button>
      <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--ink2)" }}>
        {t("limitsNote")}{" "}
        <Link href="/procurement/approval-settings">{t("limitsLink")}</Link>
      </p>
      <ConfirmDialog
        open={open}
        title={t("approveTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        description={t("approveDescription")}
        optionalReason
        reasonLabel={t("reasonLabel")}
        maxReasonLength={500}
        onConfirm={(reason) => void approve(reason)}
        onCancel={() => !busy && setOpen(false)}
      />
    </div>
  );
}
