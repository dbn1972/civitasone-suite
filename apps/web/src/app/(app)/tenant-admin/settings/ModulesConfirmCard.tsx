"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";

/**
 * W0 setup-wizard "modules" step: progress.ts (evalModules) treats the step as
 * complete only when the tenant settings carry `modulesConfirmed` /
 * `modulesConfirmedAt`, but nothing ever wrote them. This card is that writer.
 *
 * It goes through the existing tenant-settings command (PATCH
 * /v1/tenants/:id -> updateTenant command -> consumer, audited in the same
 * transaction), MERGING into the current settings like OrgTypeSelector does so
 * no other setting is wiped.
 */
export function ModulesConfirmCard({
  tenantId,
  settings,
}: {
  tenantId: string | null;
  settings: Record<string, unknown>;
}) {
  const t = useTranslations("tenantModulesConfirm");
  const router = useRouter();
  const formError = useFormError("module confirmation");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const confirmedAt = typeof settings.modulesConfirmedAt === "string" ? settings.modulesConfirmedAt : "";
  const confirmed = done || settings.modulesConfirmed === true || confirmedAt.trim().length > 0;

  async function confirm() {
    if (!tenantId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/tenants/${encodeURIComponent(tenantId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          settings: { ...settings, modulesConfirmed: true, modulesConfirmedAt: new Date().toISOString() },
        }),
      });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setDone(true);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" id="confirm-modules" style={{ marginTop: 18 }}>
      <div className="card-h">
        <h3>{t("title")}</h3>
        <Button disabled={busy || confirmed || !tenantId} aria-busy={busy} onClick={() => void confirm()}>
          {busy ? t("saving") : confirmed ? t("confirmed") : t("confirm")}
        </Button>
      </div>
      <div className="pad">
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--mut)" }}>{confirmed ? t("doneHelp") : t("help")}</p>
        <div role="status" aria-live="polite" style={{ fontSize: 12, color: "#067647", marginTop: 8 }}>
          {done ? t("success") : ""}
        </div>
        <div role="alert" aria-live="assertive" style={{ fontSize: 12, color: "var(--bad)", marginTop: 4 }}>{error}</div>
      </div>
    </div>
  );
}
