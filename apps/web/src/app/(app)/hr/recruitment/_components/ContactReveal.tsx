"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog, useConfirmAction } from "@/app/_components/ds";

export type RevealScope = "inbox" | "talent_pool";

type Props = {
  applicationId: string;
  applicantName: string;
  /** Masked by the service (never the full value). */
  email: string | null | undefined;
  mobile?: string | null | undefined;
  scope: RevealScope;
  /** Hide the button for a viewer who may not reveal (the service refuses regardless). */
  canReveal?: boolean;
};

type Revealed = { email: string | null; mobile: string | null };

/**
 * GAP-RECRUITMENT-DETAIL-08 / TALENT-POOL-02: contact details arrive MASKED from the service. "Reveal"
 * asks for a reason, calls the audited POST /applications/:id/reveal-contact (the service writes the
 * audit event before returning the values) and shows the full values for this page view only.
 */
export function ContactReveal({ applicationId, applicantName, email, mobile, scope, canReveal = true }: Props) {
  const t = useTranslations("recruitmentFinish");
  const [revealed, setRevealed] = useState<Revealed | null>(null);

  const action = useConfirmAction({
    onConfirm: async (reason) => {
      const res = await fetch(`/api/proxy/v1/hrms/applications/${applicationId}/reveal-contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: (reason ?? "").trim(), scope }),
      });
      if (!res.ok) {
        const env = (await res.clone().json().catch(() => null)) as { code?: string } | null;
        throw new Error(res.status === 403 || env?.code === "FORBIDDEN" ? t("revealForbidden") : t("revealFailed"));
      }
      const j = (await res.json()) as { data?: { email?: string | null; mobile?: string | null } };
      setRevealed({ email: j.data?.email ?? null, mobile: j.data?.mobile ?? null });
    },
  });

  const shownEmail = revealed ? revealed.email : email;
  const shownMobile = revealed ? revealed.mobile : mobile;
  const parts = [shownEmail, shownMobile].filter((p): p is string => !!p);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span data-testid={`contact-${applicationId}`}>{parts.length > 0 ? parts.join(" · ") : "—"}</span>
      {canReveal && (revealed ? (
        <button
          type="button"
          aria-pressed="true"
          aria-label={t("hideContactAria", { name: applicantName })}
          onClick={() => setRevealed(null)}
          className="text-xs text-indigo-600 dark:text-indigo-400 underline"
        >
          {t("hideContact")}
        </button>
      ) : (
        <button
          type="button"
          aria-pressed="false"
          aria-label={t("revealContactAria", { name: applicantName })}
          onClick={() => action.trigger()}
          className="text-xs text-indigo-600 dark:text-indigo-400 underline"
        >
          {t("revealContact")}
        </button>
      ))}
      <ConfirmDialog
        open={action.open}
        title={t("revealTitle", { name: applicantName })}
        description={scope === "talent_pool" ? t("revealDescriptionPool") : t("revealDescription")}
        confirmLabel={t("revealConfirm")}
        requireReason
        minReasonLength={5}
        maxReasonLength={500}
        reasonLabel={t("revealReasonLabel")}
        busy={action.busy}
        errorMessage={action.error}
        onConfirm={action.confirm}
        onCancel={action.cancel}
      />
    </span>
  );
}
