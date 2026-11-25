"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton, useToastOptional } from "@/app/_components/ds";
import { useSessionIdentity } from "@/lib/auth/useSessionIdentity";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { formatMoney } from "@/lib/formatters";

/**
 * Mirrors PROC_ROLES in procurement-service security/routes.ts. Display only:
 * the server re-checks the role and the status transition, so hiding the
 * buttons can never grant anything, only avoid offering a 403.
 */
export const EMD_BG_WRITE_ROLES = ["procurement_officer", "procurement_admin", "super_admin"] as const;

export type Register = "emd" | "pbg";
export type Disposition = "forfeit" | "refund" | "release";

/** The only live (still-actionable) state per register: EMD "collected", PBG "active". The list may show it title-cased. */
export function isActionable(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s === "collected" || s === "active";
}

/** EMD: forfeit | refund. PBG: forfeit | release. (security/domain.ts transitions.) */
export function dispositionsFor(register: Register): Disposition[] {
  return register === "emd" ? ["forfeit", "refund"] : ["forfeit", "release"];
}

export function EmdBgActions({
  id,
  register,
  status,
  vendor,
  amountPaise,
}: {
  id: string;
  register: Register;
  status: string;
  vendor: string;
  amountPaise: number;
}) {
  const t = useTranslations("procurement.emdBg.actions");
  const router = useRouter();
  const { roles, loaded } = useSessionIdentity();
  const toastCtx = useToastOptional();

  const canWrite = loaded && roles.some((r) => (EMD_BG_WRITE_ROLES as readonly string[]).includes(r));
  if (!canWrite || !isActionable(status)) return null;

  const amount = formatMoney(amountPaise);

  async function run(d: Disposition, reason?: string): Promise<void> {
    const res = await fetch(`/api/proxy/v1/procurement/${register}/${encodeURIComponent(id)}/${d}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reason ? { reason } : {}),
    });
    // 202 Accepted is the only success: the status changes later, via the queue consumer.
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {dispositionsFor(register).map((d) => (
        <ActionButton
          key={d}
          label={t(`${d}.label`)}
          danger={d === "forfeit"}
          confirmTitle={t(`${d}.title`, { amount, vendor })}
          confirmDescription={t(`${d}.description`, { amount, vendor })}
          confirmLabel={t(`${d}.confirm`)}
          requireReason={d === "forfeit"}
          optionalReason={d !== "forfeit"}
          reasonLabel={d === "forfeit" ? t("reasonRequired") : t("reasonOptional")}
          maxReasonLength={1000}
          onConfirm={(reason) => run(d, reason?.trim() || undefined)}
          onSuccess={() => {
            toastCtx?.toast.info(t(`${d}.accepted`, { amount }));
            router.refresh();
          }}
        />
      ))}
    </div>
  );
}
