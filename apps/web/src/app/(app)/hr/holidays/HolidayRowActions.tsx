"use client";

/**
 * GAP-HR-HOLIDAYS-06: DELETE /v1/hrms/holidays/:id already existed
 * (holidays/routes.ts) but no row action ever called it.
 *
 * HUMAN REVIEW (business-rule impact): the leave rules-engine reads
 * hrms_holidays for leave/attendance computation, so deleting a gazetted
 * holiday changes those calculations for every employee -- gated behind a
 * confirm dialog and to HOLIDAY_ADMIN_ROLES already (this column only
 * renders for canManage sessions), but worth a second look given the
 * downstream effect.
 */
import { useRouter } from "next/navigation";
import { ActionButton } from "../../../_components/ds";
import { useTranslations } from "next-intl";

interface Props {
  id: string;
  name: string;
}

export function HolidayRowActions({ id, name }: Props) {
  const t = useTranslations("holidays");
  const router = useRouter();

  async function handleDelete() {
    const res = await fetch(`/api/proxy/v1/hrms/holidays/${id}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) {
      throw new Error(t("deleteFailed"));
    }
  }

  return (
    <ActionButton
      label={t("delete")}
      className="btn sm danger"
      onConfirm={handleDelete}
      onSuccess={() => router.refresh()}
      confirmTitle={t("deleteConfirmTitle")}
      confirmDescription={t("deleteConfirmDescription", { name })}
    />
  );
}
