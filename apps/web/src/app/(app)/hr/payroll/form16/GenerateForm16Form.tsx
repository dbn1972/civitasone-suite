"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, StatusPill, Segmented } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type Mode = "single" | "bulk";

type BulkGenerateResponse = {
  data: { jobId: string; fy: string; message: string };
};

type BulkStatusResponse = {
  data: {
    jobId: string;
    fy: string;
    status: "pending" | "processing" | "completed" | "failed";
    totalEmployees: number;
    generated: number;
    failed: number;
  };
};

const FY_RE = /^\d{4}-\d{2}$/;
const TERMINAL = new Set(["completed", "failed"]);

export function GenerateForm16Form({ defaultFy }: { defaultFy: string }) {
  const t = useTranslations("generateForm16Form");
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("single");
  const [fy, setFy] = useState(defaultFy);
  // useState(defaultFy) above only seeds `fy` on the very first mount --
  // React ignores the initializer argument on every render after that, so a
  // parent re-rendering this already-mounted component with a new
  // defaultFy (e.g. a URL-driven fy on client-side navigation, without a
  // remounting key) would otherwise leave the field stuck on whichever FY
  // was current when this component first mounted. Resync explicitly
  // whenever the prop itself changes.
  useEffect(() => {
    setFy(defaultFy);
  }, [defaultFy]);
  const [employeeId, setEmployeeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [validationError, setValidationError] = useState<string | null>(null);
  // UX-017: validationError is now translated display text, so it can no
  // longer be prefix-matched to decide which field is invalid (same bug
  // class as PtSlabForm.tsx, tranche 12; IngestChallanForm.tsx/
  // PerquisiteComponentForm.tsx, tranche 13) -- invalidField is a stable,
  // untranslated identity kept separately from the display string. A single
  // value (not a Set) because these two checks are mutually exclusive
  // (financial year is checked first and returns before the employee-ID
  // check can run), mirroring PtSlabForm.tsx's shape.
  const [invalidField, setInvalidField] = useState<"fy" | "employeeId" | null>(null);
  const [job, setJob] = useState<BulkStatusResponse["data"] | null>(null);
  const [polling, setPolling] = useState(false);

  // UX-017: MODE_LABEL/LABEL_MODE used to be a hardcoded-English label <->
  // value map, with Segmented's onChange looking a live (now-translatable)
  // label string back up in an English-keyed table -- the same
  // translated-value-as-identity bug class, just on a toggle control instead
  // of aria-invalid wiring. Translating MODE_LABEL's values alone would have
  // permanently broken mode switching under hi.json (onChange would receive
  // a Hindi label that never matches any key in an English-keyed
  // LABEL_MODE). Fixed by deriving both the display labels and the
  // label->mode lookup from the same live t() call within this render, so
  // they always agree regardless of locale.
  const MODE_OPTIONS: { mode: Mode; label: string }[] = [
    { mode: "single", label: t("modeSingleLabel") },
    { mode: "bulk", label: t("modeBulkLabel") },
  ];
  const labelForMode = (m: Mode) => MODE_OPTIONS.find((o) => o.mode === m)?.label ?? MODE_OPTIONS[0].label;
  const modeForLabel = (label: string): Mode => MODE_OPTIONS.find((o) => o.label === label)?.mode ?? "single";

  const fyId = useId();
  const empId = useId();
  const errId = useId();
  const fyRef = useRef<HTMLInputElement>(null);
  const empRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setPolling(false);
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const pollOnce = useCallback(async (pollFy: string) => {
    try {
      const res = await browserJson<BulkStatusResponse>(
        `v1/payroll/tax/form16/bulk-status?fy=${encodeURIComponent(pollFy)}`,
      );
      setJob(res.data);
      if (TERMINAL.has(res.data.status)) {
        stopPolling();
        router.refresh();
      }
    } catch {
      // transient network error — keep polling, the terminal-state timeout below stops it
    }
  }, [router, stopPolling]);

  const startPolling = useCallback((pollFy: string) => {
    stopPolling();
    setPolling(true);
    void pollOnce(pollFy);
    pollRef.current = setInterval(() => void pollOnce(pollFy), 3000);
    window.setTimeout(() => stopPolling(), 5 * 60_000);
  }, [pollOnce, stopPolling]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);
    setInvalidField(null);
    if (!FY_RE.test(fy)) {
      setValidationError(t("financialYearRequiredError"));
      setInvalidField("fy");
      fyRef.current?.focus();
      return;
    }
    if (mode === "single" && !employeeId.trim()) {
      setValidationError(t("employeeIdRequiredError"));
      setInvalidField("employeeId");
      empRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function generate() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<BulkGenerateResponse>("v1/payroll/tax/form16/bulk-generate", {
        method: "POST",
        body: JSON.stringify({
          fy,
          employeeIds: mode === "single" ? [employeeId.trim()] : null,
        }),
      });
      setConfirmOpen(false);
      setJob({ jobId: res.data.jobId, fy: res.data.fy, status: "pending", totalEmployees: 0, generated: 0, failed: 0 });
      // Client-side polling (below) keeps this card live; router.push separately
      // re-navigates to ?fy=<res.data.fy> so the server-rendered "Bulk Filing Run"
      // card downstream also reflects the new job on its own next fetch/refresh —
      // the two update paths are intentionally independent (poll owns this card,
      // the server component owns the one below it).
      startPolling(res.data.fy);
      router.push(`/hr/payroll/form16?fy=${encodeURIComponent(res.data.fy)}`);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, padding: 0 }}>{t("scopeLegend")}</legend>
            <Segmented
              options={MODE_OPTIONS.map((o) => o.label)}
              value={labelForMode(mode)}
              onChange={(v) => {
                setMode(modeForLabel(v));
                setValidationError(null);
                setInvalidField(null);
              }}
            />
          </fieldset>

          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("financialYearLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={fyId}
                ref={fyRef}
                value={fy}
                onChange={(e) => setFy(e.target.value)}
                placeholder="2025-26"
                aria-required="true"
                aria-invalid={invalidField === "fy" || undefined}
                aria-describedby={invalidField === "fy" ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            {mode === "single" && (
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 600 }}>
                  {t("employeeIdLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
                </label>
                <input
                  id={empId}
                  ref={empRef}
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder={t("employeeIdPlaceholder")}
                  aria-required="true"
                  aria-invalid={invalidField === "employeeId" || undefined}
                  aria-describedby={invalidField === "employeeId" ? errId : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
              </div>
            )}
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              {mode === "single" ? t("generateSingleBtn") : t("generateBulkBtn")}
            </Button>
          </div>

          {validationError && (
            <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
              {validationError}
            </p>
          )}

          {job && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13 }} role="status" aria-live="polite">
              <span><strong>{t("jobLabel")}</strong> <span className="mono">{job.jobId}</span></span>
              <StatusPill status={job.status} />
              {polling && <span style={{ color: "var(--mut)" }}>{t("checkingProgress")}</span>}
              {job.status === "completed" && (
                <span style={{ color: "var(--good)" }}>
                  {job.failed > 0
                    ? t("generatedWithFailed", { generated: job.generated, failed: job.failed })
                    : t("generatedCount", { count: job.generated })}
                </span>
              )}
              {job.status === "failed" && <span style={{ color: "var(--bad)" }}>{t("jobFailedMessage")}</span>}
            </div>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={mode === "single" ? t("confirmSingleTitle") : t("confirmBulkTitle")}
        confirmLabel={t("confirmBtn")}
        danger
        busy={busy}
        errorMessage={dialogError}
        description={
          mode === "single" ? (
            t.rich("confirmDescriptionSingle", {
              empStrong: (chunks) => <strong className="mono">{chunks}</strong>,
              strong: (chunks) => <strong>{chunks}</strong>,
              employeeId,
              fy,
            })
          ) : (
            t.rich("confirmDescriptionBulk", {
              strong: (chunks) => <strong>{chunks}</strong>,
              fy,
            })
          )
        }
        onConfirm={() => void generate()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
