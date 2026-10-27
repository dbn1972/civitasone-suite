"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, StatusPill } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import type { ImportBatchSummary } from "../_data";

/**
 * OWNER DECISION #23 (TENANT-DATA-MIGRATION-01): per-import outcome with the CSV
 * error report (row, field, error) for anyone who can see the page, and a retry of
 * the FAILED records only for the migration admin. The retry is a queued command;
 * the button is disabled while it is being sent and the server audits it.
 */
export function ImportBatchPanel({
  batches,
  canRetry,
  loadFailed = false,
}: {
  batches: ImportBatchSummary[];
  canRetry: boolean;
  loadFailed?: boolean;
}) {
  const t = useTranslations("tenantW3.migration");
  const router = useRouter();
  const formError = useFormError("import");
  const [target, setTarget] = useState<ImportBatchSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [done, setDone] = useState<string | undefined>(undefined);

  async function retry() {
    if (!target || busy) return;
    setBusy(true);
    setError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/tenant/org/imports/${target.id}/retry`, { method: "POST" });
      if (!res.ok) {
        setError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setDone(t("retryQueued", { count: target.failed }));
      setTarget(null);
      router.refresh();
    } catch (caught) {
      setError(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="import-batches-h" className="card" style={{ marginBottom: 16, padding: 16 }}>
      <h2 id="import-batches-h" style={{ fontSize: 16, margin: 0 }}>{t("title")}</h2>
      <p style={{ fontSize: 13, color: "var(--ink2)" }}>{t("hint")}</p>
      {done ? <p role="status" style={{ fontSize: 13 }}>{done}</p> : null}
      {loadFailed ? (
        <p role="alert" style={{ fontSize: 13, color: "var(--bad)" }}>{t("loadFailed")}</p>
      ) : batches.length === 0 ? (
        <p style={{ fontSize: 13 }}>{t("none")}</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {batches.map((b) => (
            <li key={b.id} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <span>
                <b>{t("entity.org_unit")}</b>{" "}
                <StatusPill status={b.status} />{" "}
                <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                  {t("counts", { inserted: b.inserted, total: b.total, failed: b.failed })}
                  {b.retryCount > 0 ? ` · ${t("retries", { count: b.retryCount })}` : ""}
                </span>
              </span>
              {b.failed > 0 ? (
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <a className="btn btn-sm" href={`/api/proxy/v1/tenant/org/imports/${b.id}/errors.csv`} download aria-label={t("downloadFor", { failed: b.failed })}>
                    {t("download")}
                  </a>
                  {canRetry && b.retryable ? (
                    <Button
                      disabled={busy}
                      aria-label={t("retryFor", { failed: b.failed })}
                      style={{ minHeight: 44, minWidth: 44 }}
                      onClick={() => { setError(undefined); setDone(undefined); setTarget(b); }}
                    >
                      {t("retry")}
                    </Button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={target !== null}
        title={t("confirmTitle")}
        description={target ? t("confirmBody", { count: target.failed }) : undefined}
        confirmLabel={t("retry")}
        busy={busy}
        {...(error ? { errorMessage: error } : {})}
        onConfirm={() => void retry()}
        onCancel={() => { if (!busy) { setTarget(null); setError(undefined); } }}
      />
    </section>
  );
}
