"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { purgeInventoryCache } from "../_revalidate";

type Source = "stock" | "inventory";

/**
 * Chooses which ledger the stock screens read and post to for the whole organisation.
 * "stock" (the default) keeps today's behaviour; "inventory" posts receipts, issues, transfers and
 * adjustments to this module's own items and stores, with no stock-register items to create or link.
 * The change is queued (202) and audited by the service.
 */
export function LedgerSourceControl({ initial }: { initial: Source }) {
  const t = useTranslations("inventoryLedger");
  const router = useRouter();
  const { toast } = useToast();
  const formError = useFormError("inventory policy");
  const [value, setValue] = useState<Source>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function change(next: Source) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/proxy/v1/inventory/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ledgerSource: next }),
      });
      if (!res.ok) {
        setMessage((await formError.fromResponse(res, "save")).message);
        return;
      }
      setValue(next);
      toast.success(t("settings.saved"));
      await purgeInventoryCache();
      router.refresh();
    } catch (caught) {
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card pad" style={{ maxWidth: 560, marginTop: 16 }} aria-label={t("settings.title")}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={busy}>
        <legend><strong>{t("settings.title")}</strong></legend>
        <p id="ledger-source-help" style={{ margin: "4px 0 8px", fontSize: "0.875rem", color: "var(--ink2)" }}>{t("settings.help")}</p>
        {(["stock", "inventory"] as const).map((opt) => (
          <label key={opt} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
            <input
              type="radio"
              name="ledger-source"
              value={opt}
              checked={value === opt}
              onChange={() => { if (value !== opt) void change(opt); }}
              aria-describedby="ledger-source-help"
              style={{ marginTop: 4 }}
            />
            <span>{t(`settings.option.${opt}`)}</span>
          </label>
        ))}
      </fieldset>
      <div role="status" aria-live="polite">
        {message ? <p role="alert" style={{ marginTop: 12, fontSize: "0.875rem", color: "var(--bad)" }}>{message}</p> : null}
      </div>
    </section>
  );
}
