"use client";

/**
 * GAP-HR-DEPUTATION-02: POST /v1/hrms/deputations/:depId/{repatriate,cancel}
 * already existed (deputation/routes.ts, hr_admin/hr_officer/super_admin)
 * but no page ever offered a button for either -- an active deputation had
 * no way to be closed out from the UI at all.
 *
 * HUMAN REVIEW (state-changing HR action): repatriate/cancel restores the
 * employee's parent posting/reporting line and writes a service-book entry
 * (deputation/routes.ts's own module comment). Both actions are gated to
 * hr_admin/hr_officer/super_admin by the parent page (mirroring the
 * backend's own role list) and require an explicit confirm; the backend
 * additionally rejects (409 NOT_ACTIVE) if the deputation is no longer
 * active by the time the request lands.
 */
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton } from "@/app/_components/ds";

interface Props {
  id: string;
  employeeLabel: string;
}

export function DeputationActions({ id, employeeLabel }: Props) {
  const t = useTranslations("deputation");
  const router = useRouter();

  async function close(action: "repatriate" | "cancel") {
    const res = await fetch(`/api/proxy/v1/hrms/deputations/${id}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.status === 409) {
      throw new Error(t("card.notActive"));
    }
    if (!res.ok) {
      throw new Error(t("card.actionFailed"));
    }
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <ActionButton
        label={t("card.repatriate")}
        className="btn sm"
        onConfirm={() => close("repatriate")}
        onSuccess={() => router.refresh()}
        confirmTitle={t("card.repatriateConfirmTitle")}
        confirmDescription={t("card.repatriateConfirmDescription", { name: employeeLabel })}
      />
      <ActionButton
        label={t("card.cancel")}
        className="btn sm danger"
        onConfirm={() => close("cancel")}
        onSuccess={() => router.refresh()}
        confirmTitle={t("card.cancelConfirmTitle")}
        confirmDescription={t("card.cancelConfirmDescription", { name: employeeLabel })}
      />
    </div>
  );
}
