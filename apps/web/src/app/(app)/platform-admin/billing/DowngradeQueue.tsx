"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, DataTable } from "@/app/_components/ds";
import { formatIndianDate, formatShortId } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";

export interface PendingDowngrade extends Record<string, unknown> {
  id: string;
  tenantId: string;
  fromPlanId: string;
  targetPlanId: string;
  reason: string;
  requestedAt: string;
}

type Kind = "approve" | "reject";

/**
 * OWNER DECISION F8: platform billing approves or rejects a tenant's plan downgrade.
 * An approval does not change the plan now: it takes effect at the end of the
 * tenant's current billing period. A rejection needs a reason, recorded and shown
 * to the requester. tenant-service re-enforces the role and approver != requester.
 */
export function DowngradeQueue({ rows }: { rows: PendingDowngrade[] }) {
  const t = useTranslations("tenantW3.billing");
  const router = useRouter();
  const formError = useFormError("downgrade request");
  const [target, setTarget] = useState<{ row: PendingDowngrade; kind: Kind } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [done, setDone] = useState<string | undefined>(undefined);

  async function decide(reason?: string) {
    if (!target || busy) return;
    setBusy(true);
    setError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/tenant/subscription/downgrade-requests/${target.row.id}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: target.row.tenantId, decision: target.kind, ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setDone(target.kind === "approve" ? t("approved") : t("rejected"));
      setTarget(null);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  const label = (r: PendingDowngrade) => formatShortId(r.id);

  return (
    <section aria-labelledby="downgrade-queue-h" className="card" style={{ marginBottom: 16, padding: 16 }}>
      <h2 id="downgrade-queue-h" style={{ fontSize: 16, margin: 0 }}>{t("queueTitle")}</h2>
      <p style={{ fontSize: 13, color: "var(--ink2)" }}>{t("queueHint")}</p>
      {done ? <p role="status" style={{ fontSize: 13 }}>{done}</p> : null}
      <DataTable<PendingDowngrade>
        columns={[
          { key: "tenantId", label: t("colTenant"), render: (r) => formatShortId(r.tenantId) },
          { key: "fromPlanId", label: t("colFrom"), render: (r) => formatShortId(r.fromPlanId) },
          { key: "targetPlanId", label: t("colTo"), render: (r) => formatShortId(r.targetPlanId) },
          { key: "requestedAt", label: t("colRequested"), render: (r) => formatIndianDate(r.requestedAt) },
          { key: "reason", label: t("colReason") },
          {
            key: "id",
            label: t("colActions"),
            render: (r) => (
              <span style={{ display: "flex", gap: 8 }}>
                <Button
                  disabled={busy}
                  aria-label={`${t("approve")}: ${label(r)}`}
                  style={{ minHeight: 44, minWidth: 44 }}
                  onClick={() => { setError(undefined); setDone(undefined); setTarget({ row: r, kind: "approve" }); }}
                >
                  {t("approve")}
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  aria-label={`${t("reject")}: ${label(r)}`}
                  style={{ minHeight: 44, minWidth: 44 }}
                  onClick={() => { setError(undefined); setDone(undefined); setTarget({ row: r, kind: "reject" }); }}
                >
                  {t("reject")}
                </Button>
              </span>
            ),
          },
        ]}
        rows={rows}
        identifyingColumnKey="tenantId"
        emptyTitle={t("none")}
        emptyMessage={t("noneHint")}
      />
      <ConfirmDialog
        open={target !== null}
        title={target?.kind === "approve" ? t("approveTitle") : t("rejectTitle")}
        description={target ? <><b>{label(target.row)}</b>. {target.kind === "approve" ? t("approveBody") : t("rejectBody")}</> : undefined}
        confirmLabel={target?.kind === "approve" ? t("approve") : t("reject")}
        danger={target?.kind === "reject"}
        requireReason={target?.kind === "reject"}
        minReasonLength={3}
        maxReasonLength={1000}
        reasonLabel={t("reasonLabel")}
        busy={busy}
        {...(error ? { errorMessage: error } : {})}
        onConfirm={(reason) => void decide(reason)}
        onCancel={() => { if (!busy) { setTarget(null); setError(undefined); } }}
      />
    </section>
  );
}
