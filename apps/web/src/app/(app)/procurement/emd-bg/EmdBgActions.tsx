"use client";

import { useId, useState } from "react";
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

/**
 * The mandatory reference per disposition (security/validators.ts): a forfeit
 * needs `forfeitureOrderNo` (1-64 chars); a refund / release needs the treasury
 * `paymentRef` (UTR / PFMS, 3-64 chars). Both are trimmed server-side.
 */
export function refSpec(d: Disposition): { field: "forfeitureOrderNo" | "paymentRef"; min: number; max: number } {
  return d === "forfeit" ? { field: "forfeitureOrderNo", min: 1, max: 64 } : { field: "paymentRef", min: 3, max: 64 };
}

function DispositionButton({
  d,
  id,
  register,
  vendor,
  amount,
  reference,
}: {
  d: Disposition;
  id: string;
  register: Register;
  vendor: string;
  amount: string;
  reference?: string;
}) {
  const t = useTranslations("procurement.emdBg.actions");
  const router = useRouter();
  const toastCtx = useToastOptional();
  const [ref, setRef] = useState("");
  const inputId = useId();
  const spec = refSpec(d);
  const trimmed = ref.trim();
  const tooShort = trimmed.length < spec.min;

  async function run(reason?: string): Promise<void> {
    const body: Record<string, string> = { [spec.field]: trimmed };
    if (reason) body.reason = reason;
    const res = await fetch(`/api/proxy/v1/procurement/${register}/${encodeURIComponent(id)}/${d}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    // 202 Accepted is the only success: the status changes later, via the queue consumer.
    if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
  }

  const values = { amount, vendor, reference: reference ?? "" };
  return (
    <ActionButton
      label={t(`${d}.label`)}
      danger={d === "forfeit"}
      confirmTitle={t(`${d}.title`, values)}
      confirmDescription={t(`${d}.description`, values)}
      confirmLabel={t(`${d}.confirm`)}
      optionalReason
      reasonLabel={t("reasonOptional")}
      maxReasonLength={1000}
      blockConfirm={tooShort}
      onConfirm={run}
      onSuccess={() => {
        setRef("");
        toastCtx?.toast.info(t(`${d}.accepted`, values));
        router.refresh();
      }}
    >
      <div style={{ margin: "12px 0" }}>
        <label htmlFor={inputId} style={{ display: "block", fontWeight: 600 }}>
          {t(`${d}.refLabel`)}
        </label>
        <input
          id={inputId}
          type="text"
          value={ref}
          maxLength={spec.max}
          onChange={(e) => setRef(e.target.value)}
          aria-required="true"
          autoComplete="off"
          style={{ width: "100%", minHeight: 44 }}
        />
        {trimmed.length > 0 && tooShort ? (
          <p role="alert" style={{ margin: "4px 0 0", fontSize: "0.875rem", color: "#b42318" }}>
            {t("refTooShort", { min: spec.min })}
          </p>
        ) : null}
      </div>
    </ActionButton>
  );
}

export function EmdBgActions({
  id,
  register,
  status,
  vendor,
  amountPaise,
  reference,
}: {
  id: string;
  register: Register;
  status: string;
  vendor: string;
  amountPaise: number;
  reference?: string;
}) {
  const { roles, loaded } = useSessionIdentity();
  const canWrite = loaded && roles.some((r) => (EMD_BG_WRITE_ROLES as readonly string[]).includes(r));
  if (!canWrite || !isActionable(status)) return null;
  const amount = formatMoney(amountPaise);

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {dispositionsFor(register).map((d) => (
        <DispositionButton key={d} d={d} id={id} register={register} vendor={vendor} amount={amount} reference={reference} />
      ))}
    </div>
  );
}
