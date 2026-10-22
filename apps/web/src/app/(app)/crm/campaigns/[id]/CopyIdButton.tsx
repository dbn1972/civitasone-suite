"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../../../../_components/ds";

/**
 * GAP-CRM-CAMPAIGNS-DETAIL-01: a campaign without a name is identified by a SHORT
 * id on screen; this copies the FULL id (the support reference / API key) to the
 * clipboard instead of printing a 36-character UUID in the page. The confirmation
 * and a copy failure are both announced via an aria-live region.
 */
export function CopyIdButton({ value }: { value: string }) {
  const t = useTranslations("crmCampaignDetail");
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Button type="button" variant="ghost" style={{ minHeight: 36 }} onClick={() => void copy()} aria-label={t("copyIdAria")}>
        {t("copyId")}
      </Button>
      <span role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--muted)" }}>
        {state === "copied" ? t("copied") : state === "failed" ? t("copyFailed") : ""}
      </span>
    </span>
  );
}
