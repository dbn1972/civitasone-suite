"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../ds";
import { downloadServerCsv } from "@/lib/crm/crmExport";

/**
 * F2 — a CSV export button backed by the SERVER-AUDITED export endpoints.
 *
 * Unlike DataTable's client-side Blob export (which cannot be audited and only
 * ever saw the current page), this button:
 *   - requires the operator to state a PURPOSE (min 10 chars), sent to and
 *     recorded by the server as part of the bulk-export audit event;
 *   - calls the server endpoint, which applies the active filters, masks PII by
 *     role and enforces the admin gate — the server is the authority;
 *   - downloads whatever CSV the server returns (already masked/filtered).
 *
 * A 403 (non-admin) or 400 (purpose too short) surfaces as clerk-safe copy.
 */
export function ServerExportButton({
  endpointPath,
  filenameBase,
  filters = {},
  kind,
}: {
  /** Gateway path, e.g. "v1/crm/service-requests/export". */
  endpointPath: string;
  /** Base of the downloaded file name (date is appended). */
  filenameBase: string;
  /** Active filters to forward to the server, so the export matches the view. */
  filters?: Record<string, string | undefined>;
  /** Which register is exported; selects the translated title and description. */
  kind: "activities" | "grievances" | "leadForms" | "serviceRequests" | "voc";
}) {
  const t = useTranslations("crmExport");
  const title = t(`${kind}Title`);
  const description = t(`${kind}Description`);
  const [open, setOpen] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const purposeValid = purpose.trim().length >= 10;

  async function run() {
    if (!purposeValid) {
      setError(t("purposeRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { filename } = await downloadServerCsv(endpointPath, purpose.trim(), filters, filenameBase);
      setDone(t("done", { filename }));
      setOpen(false);
      setPurpose("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen((v) => !v); setError(null); setDone(null); }}>
        {t("button")}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label={title}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 12,
            border: "1px solid var(--line)",
            borderRadius: "var(--r)",
            background: "var(--panel)",
            maxWidth: 420,
          }}
        >
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0 }}>{description}</p>
          <label style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
            {t("purposeLabel")}
            <textarea
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              rows={2}
              placeholder={t("purposePlaceholder")}
              style={{ fontSize: 13, padding: 6, border: "1px solid var(--line)", borderRadius: "var(--r)" }}
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <Button type="button" size="sm" disabled={busy || !purposeValid} onClick={() => void run()}>
              {busy ? t("exporting") : t("export")}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setOpen(false); setPurpose(""); setError(null); }}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ fontSize: 13, color: "var(--danger, #b42318)", margin: 0 }}>{error}</p>
      )}
      {done && (
        <p role="status" aria-live="polite" style={{ fontSize: 13, color: "#047857", margin: 0 }}>{done}</p>
      )}
    </span>
  );
}
