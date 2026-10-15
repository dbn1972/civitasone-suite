"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-01: enable / disable a channel via
 * PATCH /notifications/channels/:id (CQRS command, audited). Disabling asks for
 * confirmation and a reason. Edit and test-send are deliberately NOT offered:
 * the notification-service has no such endpoint, and a dead button is worse
 * than none.
 */
export function ChannelRowActions({ id, name, enabled, isDefault }: { id: string; name: string; enabled: boolean; isDefault: boolean }) {
  const t = useTranslations("tenantAdminW2.channels");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const formError = useFormError("notification channel");

  async function apply(next: boolean, reason?: string): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/notification/channels/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next ? { enabled: true } : { enabled: false, reason }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return false;
      }
      setNotice(t(next ? "enabledOk" : "disabledOk", { name }));
      router.refresh();
      return true;
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {enabled ? (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setError(undefined); setNotice(""); setOpen(true); }}>
          {t("disable")}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void apply(true)}>
          {t("enable")}
        </Button>
      )}
      {notice ? <span role="status" aria-live="polite" style={{ fontSize: 12, marginLeft: 8 }}>{notice}</span> : null}
      {!notice && error && !open ? <span role="alert" style={{ fontSize: 12, marginLeft: 8, color: "var(--bad)" }}>{error}</span> : null}
      <ConfirmDialog
        open={open}
        title={t("disableTitle", { name })}
        description={<>{t("disableDescription")}{isDefault ? <> <b>{t("defaultWarning")}</b></> : null}</>}
        confirmLabel={t("disableConfirm")}
        danger
        requireReason
        reasonLabel={t("reasonLabel")}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void apply(false, reason).then((ok) => { if (ok) setOpen(false); })}
        onCancel={() => { if (!busy) { setOpen(false); setError(undefined); } }}
      />
    </>
  );
}
