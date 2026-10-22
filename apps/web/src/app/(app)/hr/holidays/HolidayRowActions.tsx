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
 *
 * The delete is a queued (F3) write: the 204 means "received", the row only
 * disappears once the consumer has run. `onQueued` lets the table show the
 * shared "received, updating" notice (AcceptedNotice) instead of implying the
 * row is already gone.
 */
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton } from "../../../_components/ds";

interface Props {
  id: string;
  name: string;
  /** Called once the backend has accepted (queued) the deletion. */
  onQueued?: (name: string) => void;
}

export function HolidayRowActions({ id, name, onQueued }: Props) {
  const t = useTranslations("holidays");
  const router = useRouter();

  async function handleDelete() {
    let res: Response;
    try {
      res = await fetch(`/api/proxy/v1/hrms/holidays/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      throw new Error(t("deleteFailed"));
    }
    if (res.ok || res.status === 204) return;
    // Only fixed, translated copy is ever shown -- never the backend body.
    if (res.status === 403) throw new Error(t("deleteForbidden"));
    if (res.status === 404) {
      // Already gone (deleted by someone else / a repeat click): the list is
      // simply stale, so say so and let the refresh below correct it.
      router.refresh();
      throw new Error(t("deleteNotFound"));
    }
    throw new Error(t("deleteFailed"));
  }

  return (
    <ActionButton
      label={t("delete")}
      className="btn sm danger"
      danger
      onConfirm={handleDelete}
      onSuccess={() => {
        onQueued?.(name);
        router.refresh();
      }}
      confirmTitle={t("deleteConfirmTitle")}
      confirmDescription={t("deleteConfirmDescription", { name })}
      confirmLabel={t("deleteConfirmAction")}
      cancelLabel={t("deleteCancelAction")}
    />
  );
}
