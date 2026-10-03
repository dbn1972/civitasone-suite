"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { putWithErrorCode } from "../_lib/postWithErrorCode";
import { MAX_REASON_LENGTH, MIN_REASON_LENGTH } from "./payGroupMembership";

/**
 * Tenant setting: may membership changes start mid-month? Reads
 * GET /v1/payroll/pay-group-settings (passed in by the page); a change asks
 * for a reason and PUTs the new value. `allowMidMonth === null` means the
 * setting could not be loaded -- shown as unavailable, never as "off".
 */
export function MembershipSettings({ allowMidMonth }: { allowMidMonth: boolean | null }) {
  const t = useTranslations("payGroupMembers");
  const router = useRouter();
  const checkboxId = useId();
  const [pending, setPending] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(reason?: string) {
    if (pending === null) return;
    setBusy(true);
    setError(undefined);
    try {
      await putWithErrorCode(
        "v1/payroll/pay-group-settings",
        { allowMidMonthEffective: pending, reason: (reason ?? "").trim() },
        {},
        { area: t("settingsArea"), statusAware: true },
      );
      setPending(null);
      setNotice(t("settingsSaved"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("settingsTitle")} padding>
      {allowMidMonth === null ? (
        <p role="status" style={{ margin: 0 }}>{t("settingsUnavailable")}</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <label htmlFor={checkboxId} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
            <input
              id={checkboxId}
              type="checkbox"
              checked={allowMidMonth}
              onChange={(e) => {
                setError(undefined);
                setNotice(null);
                setPending(e.target.checked);
              }}
            />
            {t("midMonthLabel")}
          </label>
          <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>{t("midMonthHint")}</p>
          {notice && <p role="status" className="pill good" style={{ margin: 0, width: "fit-content" }}>{notice}</p>}
        </div>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={t("settingsConfirmTitle")}
        description={pending ? t("settingsConfirmOn") : t("settingsConfirmOff")}
        confirmLabel={t("settingsConfirmLabel")}
        requireReason
        minReasonLength={MIN_REASON_LENGTH}
        maxReasonLength={MAX_REASON_LENGTH}
        reasonLabel={t("reasonLabel")}
        busy={busy}
        errorMessage={error}
        onConfirm={(r) => void submit(r)}
        onCancel={() => !busy && setPending(null)}
      />
    </Card>
  );
}
