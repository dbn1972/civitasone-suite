"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import {
  availableChanges, otherRole, requestOperatorChange, type OperatorChangeKind, type PendingRequestRef,
} from "@/lib/admin/operatorActions";

export interface OperatorActionRow {
  id?: string;
  name: string;
  role: string;
  status: string;
  pendingRequest: PendingRequestRef | null;
}

/**
 * GAP-ADMIN-OPERATORS-05: the per-row change buttons. A click opens a dialog that requires a reason and
 * sends a REQUEST; nothing about the operator changes until a different super admin approves it.
 */
export function OperatorRowActions({ row, viewerId, onSent }: { row: OperatorActionRow; viewerId: string | null; onSent: () => void }) {
  const t = useTranslations("adminOperators");
  const router = useRouter();
  const [kind, setKind] = useState<OperatorChangeKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (row.pendingRequest) return <span className="pill warn">{t("pendingBadge")}</span>;
  const kinds = availableChanges(row, viewerId);
  if (kinds.length === 0) return <span aria-hidden="true">{"—"}</span>;

  const label = (k: OperatorChangeKind) => (k === "suspend" ? t("suspend") : k === "reactivate" ? t("reactivate") : t("roleChange"));
  const roleName = (r: string) => (r === "super_admin" || r === "platform_admin" ? t(`role.${r}`) : t("role.unknown"));
  const target = otherRole(row.role);

  async function confirm(reason: string | undefined) {
    if (!kind || !reason || !row.id) return;
    setBusy(true);
    setError(undefined);
    const r = await requestOperatorChange(row.id ?? "", { kind, reason, ...(kind === "role_change" && target ? { toRole: target } : {}) });
    setBusy(false);
    if (!r.ok) { setError(t(`error.${r.code}`)); return; }
    setKind(null);
    onSent();
    // The directory shows the pending badge once the worker has recorded the request.
    window.setTimeout(() => router.refresh(), 1200);
  }

  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {kinds.map((k) => (
        <Button key={k} variant="ghost" size="sm" aria-label={t("actionAria", { action: label(k), name: row.name })}
          onClick={() => { setError(undefined); setKind(k); }}>
          {label(k)}
        </Button>
      ))}
      <ConfirmDialog
        open={kind !== null}
        danger={kind === "suspend"}
        requireReason
        minReasonLength={3}
        maxReasonLength={500}
        reasonLabel={t("reasonLabel")}
        title={kind ? t(`requestTitle.${kind}`, { name: row.name }) : ""}
        description={kind ? t(`requestImpact.${kind}`, { name: row.name, from: roleName(row.role), to: roleName(target ?? "") }) : ""}
        confirmLabel={t("requestConfirm")}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void confirm(reason)}
        onCancel={() => { if (!busy) setKind(null); }}
      />
    </span>
  );
}
