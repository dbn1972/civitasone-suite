"use client";

/**
 * F1-05 — audited reveal control for a server-masked PII value.
 *
 * The page only ever receives the SERVER-masked value. When the viewer holds a
 * reveal-allowed role, this control offers a "Reveal" button that opens a
 * reason dialog, POSTs { resourceType, resourceId, field, reason } to the
 * audited `/api/v1/crm/pii/reveal` endpoint, and shows the clear value the
 * server returns. The reveal is never purely client-side: the clear value only
 * exists after the server has written its `pii_reveal` audit event. The value
 * re-masks itself after `autoHideMs` and on unmount, and is never stored.
 *
 * This mirrors ds/RevealableValue.tsx (the finance audited-reveal control) but
 * targets the CRM reveal contract and the ds `Masked` glyph format, so the
 * citizen-facing CRM detail pages get a reveal that matches `Masked`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { browserFetch } from "@/lib/api/browserClient";
import { ConfirmDialog } from "./ConfirmDialog";

export type PiiResourceType = "grievance" | "rti" | "service_request" | "onboarding" | "contact";

export interface MaskedRevealProps {
  /** The server-masked text to show until a reveal succeeds. */
  maskedText: string;
  resourceType: PiiResourceType;
  resourceId: string;
  /** The API field name to reveal, e.g. `citizenPhone`. */
  field: string;
  /** Accessible label for the value ("citizen phone"). */
  label: string;
  autoHideMs?: number;
  className?: string;
}

const MIN_REASON = 10;
const MAX_REASON = 2000;

/** Pull the clear value out of the reveal endpoint's `{ data: { value } }`. */
function pickValue(json: unknown): string | null {
  if (json && typeof json === "object" && "data" in (json as object)) {
    const d = (json as { data: unknown }).data;
    if (d && typeof d === "object" && "value" in (d as object)) {
      const v = (d as { value: unknown }).value;
      return typeof v === "string" ? v : null;
    }
  }
  return null;
}

export function MaskedReveal({
  maskedText,
  resourceType,
  resourceId,
  field,
  label,
  autoHideMs = 30_000,
  className,
}: MaskedRevealProps) {
  const t = useTranslations("piiReveal");
  const [clear, setClear] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setClear(null);
  }, []);
  useEffect(() => hide, [hide]);

  async function reveal(reason?: string) {
    const r = (reason ?? "").trim();
    if (r.length < MIN_REASON) return;
    setBusy(true);
    setError("");
    try {
      const res = await browserFetch("v1/crm/pii/reveal", {
        method: "POST",
        body: JSON.stringify({ resourceType, resourceId, field, reason: r }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? t("forbidden") : t("failed"));
        return;
      }
      const value = pickValue(await res.json());
      if (!value) {
        setError(t("unavailable"));
        return;
      }
      setClear(value);
      setOpen(false);
      timer.current = setTimeout(hide, autoHideMs);
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span
        style={{ fontFamily: "monospace" }}
        aria-label={clear === null ? t("maskedAria", { label }) : label}
        {...(clear !== null ? { "aria-live": "polite" as const } : {})}
      >
        {clear ?? maskedText}
      </span>
      {clear === null ? (
        <button
          type="button"
          className="btn ghost"
          style={{ padding: "0 8px", fontSize: 12 }}
          aria-pressed={false}
          onClick={() => {
            setError("");
            setOpen(true);
          }}
        >
          {t("reveal")}
        </button>
      ) : (
        <button
          type="button"
          className="btn ghost"
          style={{ padding: "0 8px", fontSize: 12 }}
          aria-pressed={true}
          onClick={hide}
        >
          {t("hide")}
        </button>
      )}
      <ConfirmDialog
        open={open}
        title={t("title", { label })}
        description={t("description", { label })}
        confirmLabel={t("confirm")}
        requireReason
        reasonLabel={t("reasonLabel")}
        minReasonLength={MIN_REASON}
        maxReasonLength={MAX_REASON}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => {
          void reveal(reason);
        }}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
      />
    </span>
  );
}
