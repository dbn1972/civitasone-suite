"use client";

/**
 * GAP-FINANCE-VENDORS-01: deactivate / reactivate a vendor from its detail
 * page. PATCH /v1/finance/vendors/:id { version, isActive } -- finance-service
 * restricts it to finance_admin / super_admin and rejects a stale `version`
 * with 409 (optimistic lock), surfaced here as a clerk-safe message.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ActionButton } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";

export function VendorStatusAction({ id, version, isActive, name }: { id: string; version: number; isActive: boolean; name: string }) {
  const t = useTranslations("financeVendorStatus");
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <ActionButton
        label={isActive ? t("deactivateLabel") : t("reactivateLabel")}
        className="btn ghost"
        danger={isActive}
        confirmTitle={isActive ? t("deactivateTitle", { name }) : t("reactivateTitle", { name })}
        confirmDescription={isActive ? t("deactivateDescription") : t("reactivateDescription")}
        confirmLabel={isActive ? t("deactivateConfirm") : t("reactivateConfirm")}
        onConfirm={async () => {
          const res = await fetch(`/api/proxy/v1/finance/vendors/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ version, isActive: !isActive }),
          });
          if (!res.ok) {
            const human = toHumanError(res.status === 409 ? "conflict" : "save", { area: "vendor" });
            throw new Error(`${human.what} ${human.next}`);
          }
        }}
        onSuccess={() => { setNote(isActive ? t("deactivated") : t("reactivated")); router.refresh(); }}
      />
      {note ? <span role="status" style={{ fontSize: 12 }}>{note}</span> : null}
    </>
  );
}
