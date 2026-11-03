"use client";

/**
 * Masked value with a role-gated, audited, time-boxed reveal (fp-finance-02: vendor PAN / account /
 * phone / email, cheque bank account number).
 *
 * The masked form is the only thing the page ever receives. Reveal asks for a reason, POSTs it to a
 * server endpoint that writes the audit event (actor + reason, never the value) and only then returns
 * the clear value; this component never reveals purely client-side. The clear value re-masks itself
 * after `autoHideMs` and on unmount, and is never written to storage.
 *
 * `canReveal` false -> no Reveal control at all (the DOM never holds the clear value for that user).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { browserFetch } from "@/lib/api/browserClient";
import { workflowErrorMessage } from "@/lib/finance/workflowErrors";
import { ConfirmDialog } from "./ConfirmDialog";

export interface RevealableValueProps {
  /** Already-masked text from the server (shown until a reveal succeeds). */
  maskedText: string;
  /** Proxy path of the audited reveal endpoint, e.g. `v1/finance/vendors/<id>/reveal`. */
  revealPath: string;
  /** JSON body for the reveal call (the reason is added). */
  revealBody?: Record<string, unknown>;
  /**
   * Picks the clear string out of the endpoint's JSON response. Client callers only: a function
   * cannot cross the Server -> Client boundary, so a Server Component passing `pick` crashes the
   * whole page render ("Functions cannot be passed directly to Client Components"). Server
   * Components pass `pickPath` instead.
   */
  pick?: (json: unknown) => string | null | undefined;
  /**
   * Serialisable alternative to `pick`: the property path of the clear string in the response,
   * e.g. `["values", "pan"]` for `{ values: { pan } }`. Used when `pick` is absent.
   */
  pickPath?: readonly string[];
  canReveal: boolean;
  /** What is being revealed, for the accessible name and the dialog ("PAN", "account number"). */
  label: string;
  /** Shown when there is nothing to mask. */
  fallback?: React.ReactNode;
  autoHideMs?: number;
  className?: string;
  /**
   * Reason length bounds, for an endpoint that enforces its own (defaults 5 and 300, the vendor / cheque
   * reveals). Set both to match the route, e.g. the TDS PAN reveal needs 10 to 500, so the dialog never
   * lets through a reason the server would 400.
   */
  minReasonLength?: number;
  maxReasonLength?: number;
  /**
   * What record the value belongs to (e.g. the vendor name), for a control repeated once per table row.
   * When set it is appended to the Reveal / Hide button's accessible name ("Reveal PAN for Vendor A"), so a
   * screen-reader button list can tell the rows apart. The visible text stays "Reveal" / "Hide".
   */
  context?: string;
}

/** The string at `path` inside `json`, or undefined (never throws on a missing/odd shape). */
export function pickByPath(json: unknown, path: readonly string[]): string | undefined {
  let cur: unknown = json;
  for (const seg of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return typeof cur === "string" ? cur : undefined;
}

const MIN_REASON = 5;
const MAX_REASON = 300;

export function RevealableValue({
  maskedText, revealPath, revealBody, pick, pickPath, canReveal, label, fallback = "—", autoHideMs = 30_000, className,
  minReasonLength = MIN_REASON, maxReasonLength = MAX_REASON, context,
}: RevealableValueProps) {
  const t = useTranslations("revealableValue");
  const te = useTranslations("financeWorkflowErrors");
  const [clear, setClear] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setClear(null);
  }, []);
  useEffect(() => hide, [hide]);

  async function reveal(reason?: string) {
    const r = (reason ?? "").trim();
    if (r.length < minReasonLength) return;
    setBusy(true);
    setError("");
    try {
      const res = await browserFetch(revealPath, { method: "POST", body: JSON.stringify({ ...(revealBody ?? {}), reason: r }) });
      if (!res.ok) {
        setError(await workflowErrorMessage(res, te, "load", label));
        return;
      }
      const json: unknown = await res.json();
      const value = pick ? pick(json) : pickByPath(json, pickPath ?? []);
      if (!value) { setError(t("unavailable")); return; }
      setClear(value);
      setOpen(false);
      timer.current = setTimeout(hide, autoHideMs);
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!maskedText && clear === null) return <>{fallback}</>;
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span
        style={{ fontFamily: "monospace" }}
        aria-label={clear === null ? t("maskedAria", { label }) : label}
        {...(clear !== null ? { "aria-live": "polite" as const } : {})}
      >
        {clear ?? maskedText}
      </span>
      {canReveal ? (
        clear === null ? (
          <button type="button" className="btn ghost" style={{ padding: "0 8px", fontSize: 12 }} aria-pressed={false}
            {...(context ? { "aria-label": t("revealAria", { label, context }) } : {})}
            onClick={() => { setError(""); setOpen(true); }}>
            {t("reveal")}
          </button>
        ) : (
          <button type="button" className="btn ghost" style={{ padding: "0 8px", fontSize: 12 }} aria-pressed={true}
            {...(context ? { "aria-label": t("hideAria", { label, context }) } : {})}
            onClick={hide}>
            {t("hide")}
          </button>
        )
      ) : null}
      <ConfirmDialog
        open={open}
        title={t("title", { label })}
        description={t("description", { label })}
        confirmLabel={t("confirm")}
        requireReason
        reasonLabel={t("reasonLabel")}
        minReasonLength={minReasonLength}
        maxReasonLength={maxReasonLength}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => { void reveal(reason); }}
        onCancel={() => { if (!busy) setOpen(false); }}
      />
    </span>
  );
}
