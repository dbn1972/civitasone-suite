"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, EntityPicker } from "@/app/_components/ds";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { isValidFy } from "@/lib/validators/fy";

type BulkStatus = { status: string } | null;

function StepBar({ step, steps, ariaLabel }: { step: number; steps: string[]; ariaLabel: string }) {
  return (
    <nav aria-label={ariaLabel} style={{ display: "flex", marginBottom: 28 }}>
      {steps.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: done ? "var(--good, #27ae60)" : active ? "var(--accent, #2563eb)" : "var(--line2)",
                  color: done || active ? "#fff" : "var(--ink2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700,
                }}
                aria-current={active ? "step" : undefined}
              >
                {done ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 11, marginTop: 4, color: active ? "var(--accent, #2563eb)" : "var(--ink2)", whiteSpace: "nowrap" }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? "var(--good, #27ae60)" : "var(--line2)", margin: "0 6px", marginBottom: 20 }} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * GAP-PAYROLL-FORM16-02: this table used to synthesize a plausible-looking
 * challan reference ("CHLN-FY{fy}-Q{n}") for all four quarters out of thin
 * air, with Gross Salary/TDS Deducted hard-coded "—" -- read as if it were
 * real 24Q challan data. No challan-reference endpoint is wired to this
 * wizard (the per-quarter TDS amounts GET /v1/payroll/tax/form16 returns are
 * real, but it has no challan serial/CIN -- those live in a separate
 * statutory-returns challan table this wizard doesn't query), so the table
 * now honestly shows "Not available" instead of a fabricated reference.
 */
function TdsReconciliationTable({ t }: { t: ReturnType<typeof useTranslations> }) {
  const columnHeaders = [t("colQuarter"), t("colGrossSalary"), t("colTdsDeducted"), t("colChallanRef")];
  const quarters = [t("quarterQ1"), t("quarterQ2"), t("quarterQ3"), t("quarterQ4")];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--line2)" }}>
            {columnHeaders.map((h) => (
              <th key={h} style={{ padding: "8px 10px", textAlign: "start", fontWeight: 600, color: "var(--ink2)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {quarters.map((q) => (
            <tr key={q} style={{ borderBottom: "1px solid var(--line2)" }}>
              <td style={{ padding: "8px 10px" }}>{q}</td>
              <td style={{ padding: "8px 10px", textAlign: "end", color: "var(--ink2)" }}>—</td>
              <td style={{ padding: "8px 10px", textAlign: "end", color: "var(--ink2)" }}>—</td>
              <td style={{ padding: "8px 10px", fontSize: 12, color: "var(--ink2)" }}>
                {t("challanRefNotAvailable")}
              </td>
            </tr>
          ))}
          <tr style={{ borderTop: "2px solid var(--line2)", background: "var(--panel)" }}>
            <td style={{ padding: "8px 10px", fontWeight: 700 }}>{t("annualTotal")}</td>
            <td style={{ padding: "8px 10px", textAlign: "end", fontWeight: 700 }}>—</td>
            <td style={{ padding: "8px 10px", textAlign: "end", fontWeight: 700 }}>—</td>
            <td style={{ padding: "8px 10px" }} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function Form16Wizard({ defaultFy }: { defaultFy: string }) {
  const t = useTranslations("form16Wizard");
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [fy, setFy] = useState(defaultFy);
  const [fyError, setFyError] = useState(false);
  // GAP-PAYROLL-FORM16-03: blank employeeId used to silently mean "every
  // employee", with no explicit choice and no confirmation. Scope is now an
  // explicit radio; "one" requires picking a real employee via the shared
  // EntityPicker (ds/EntityPicker.tsx + the existing employee directory
  // adapter) instead of pasting a raw id.
  const [scope, setScope] = useState<"all" | "one">("all");
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [jobId, setJobId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // GAP-PAYROLL-FORM16-04: polls bulk-status (the same endpoint page.tsx's
  // server-side status card already uses) instead of showing the download
  // link the instant the job is queued -- generation is asynchronous, so
  // that link was dead until the run actually finished.
  const [bulkStatus, setBulkStatus] = useState<BulkStatus>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fyId = useId();

  const STEP_NAMES = useMemo(
    () => [t("stepSelectFy"), t("stepReview"), t("stepGenerateDownload")],
    [t],
  );

  const panelRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    panelRef.current?.focus();
    setAnnouncement(
      t("stepProgress", { current: step + 1, total: STEP_NAMES.length, name: STEP_NAMES[step] ?? "" }),
    );
  }, [step, t, STEP_NAMES]);

  // GAP-PAYROLL-FORM16-04: cap polling (2.5 min at 5s) so a stuck job can't
  // poll forever; stop on completed/failed either way.
  useEffect(() => {
    if (step !== 2 || !jobId) return;
    let attempts = 0;
    async function poll() {
      attempts += 1;
      try {
        const res = await fetch(`/api/proxy/v1/payroll/tax/form16/bulk-status?fy=${encodeURIComponent(fy)}`);
        if (res.ok) {
          const d = (await res.json()) as { data?: { status?: string } };
          const status = d?.data?.status;
          if (status) {
            setBulkStatus({ status });
            if (status === "completed" || status === "failed") {
              if (pollRef.current) clearInterval(pollRef.current);
              router.refresh();
              return;
            }
          }
        }
      } catch {
        // transient network error: let the next tick retry
      }
      if (attempts >= 30 && pollRef.current) clearInterval(pollRef.current);
    }
    void poll();
    pollRef.current = setInterval(() => void poll(), 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, jobId, fy, router]);

  function handleNext() {
    if (!isValidFy(fy)) {
      setFyError(true);
      return;
    }
    setFyError(false);
    // GAP-PAYROLL-FORM16-07: the wizard's own FY field used to be
    // independent of the URL/status-card FY entirely. Syncing here means a
    // changed FY takes effect; because page.tsx keys the wizard on `fy`
    // (key={fy}), this remounts the wizard once the URL updates -- the
    // remounted instance starts over at step 0 with the new FY already
    // filled in (not stranded on the old step), so the user clicks Next
    // once more to actually proceed. When the FY is unchanged from
    // `defaultFy`, no remount happens and this advances immediately.
    if (fy !== defaultFy) {
      router.replace(`?fy=${encodeURIComponent(fy)}`);
      return;
    }
    setStep(1);
  }

  async function generateForm16() {
    setBusy(true);
    setError(undefined);
    try {
      const body: Record<string, unknown> = { fy };
      if (scope === "one") {
        if (!employeeId) {
          setError(t("employeeRequiredError"));
          setBusy(false);
          return;
        }
        body.employeeIds = [employeeId];
      }
      const res = await fetch("/api/proxy/v1/payroll/tax/form16/bulk-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setError(d?.error?.message ?? t("generationFailedDefault"));
        setConfirmOpen(false);
        return;
      }
      const d = await res.json().catch(() => ({})) as { data?: { jobId?: string } };
      setJobId(d?.data?.jobId ?? null);
      setBulkStatus(null);
      setConfirmOpen(false);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("networkErrorDefault"));
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const canDownload = bulkStatus?.status === "completed";
  const generationFailed = bulkStatus?.status === "failed";

  return (
    <div style={{ padding: "20px 24px" }}>
      <StepBar step={step} steps={STEP_NAMES} ariaLabel={t("stepAriaLabel")} />
      <div aria-live="polite" className="sr-only">{announcement}</div>

      {/* Step 0 — Select FY */}
      {step === 0 && (
        <div ref={panelRef} tabIndex={-1} role="group" aria-label={STEP_NAMES[0] ?? ""} style={{ display: "grid", gap: 16 }}>
          <div style={{ maxWidth: 260 }}>
            <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>{t("financialYearLabel")}</label>
            <input
              id={fyId}
              type="text"
              className="input"
              value={fy}
              onChange={(e) => { setFy(e.target.value); setFyError(false); }}
              placeholder="2024-25"
              aria-invalid={fyError || undefined}
            />
            <p style={{ fontSize: 11, color: fyError ? "var(--bad, #c0392b)" : "var(--ink2)", marginTop: 4 }}>
              {fyError ? t("financialYearInvalidError") : t("financialYearFormatHint")}
            </p>
          </div>
          <div>
            <Button onClick={handleNext}>{t("nextBtn")}</Button>
          </div>
        </div>
      )}

      {/* Step 1 — Review scope + TDS reconciliation */}
      {step === 1 && (
        <div ref={panelRef} tabIndex={-1} role="group" aria-label={STEP_NAMES[1] ?? ""} style={{ display: "grid", gap: 22 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{t("scopeHeading")}</h3>
            <fieldset style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              <legend className="sr-only">{t("scopeHeading")}</legend>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="radio" name="form16-scope" checked={scope === "all"} onChange={() => setScope("all")} />
                {t("scopeAllLabel")}
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input type="radio" name="form16-scope" checked={scope === "one"} onChange={() => setScope("one")} />
                {t("scopeOneLabel")}
              </label>
              {scope === "one" && (
                <div style={{ maxWidth: 360, marginLeft: 24 }}>
                  <EntityPicker
                    value={employeeId}
                    onChange={(v) => setEmployeeId(Array.isArray(v) ? (v[0] ?? null) : v)}
                    search={searchEmployees}
                    resolve={resolveEmployees}
                    aria-label={t("scopeOneLabel")}
                    placeholder={t("employeePickerPlaceholder")}
                  />
                </div>
              )}
            </fieldset>
          </div>

          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{t("annualTdsReconciliationHeading", { fy })}</h3>
            <p style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 10 }}>{t("tdsReconciliationNote")}</p>
            <TdsReconciliationTable t={t} />
          </div>

          {error && <p role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 13 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="ghost" onClick={() => setStep(0)}>{t("backBtn")}</Button>
            <Button onClick={() => setConfirmOpen(true)} disabled={busy}>
              {t("generateBtn")}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2 — Download */}
      {step === 2 && (
        <div ref={panelRef} tabIndex={-1} role="group" aria-label={STEP_NAMES[2] ?? ""} style={{ display: "grid", gap: 16 }}>
          <div style={{ background: canDownload ? "var(--goodbg, #e6f7f0)" : "var(--panel)", borderRadius: 12, padding: "28px", textAlign: "center" }}>
            <p style={{ fontSize: 36, margin: "0 0 10px" }}>{canDownload ? "✅" : generationFailed ? "⚠️" : "⏳"}</p>
            <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
              {canDownload ? t("generationCompleteTitle") : generationFailed ? t("generationFailedTitle") : t("generationStartedTitle")}
            </p>
            {jobId && <p style={{ fontSize: 12, fontFamily: "monospace", color: "var(--ink2)" }}>{t("jobIdLabel", { jobId })}</p>}
            {!canDownload && !generationFailed && (
              <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 8 }} aria-live="polite">
                {t("generationAsyncNote")}
              </p>
            )}
            <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              {canDownload && (
                <a className="btn" href={`/api/proxy/v1/payroll/tax/form16/bulk-download?fy=${encodeURIComponent(fy)}`}>
                  {t("downloadZipBtn")}
                </a>
              )}
              <Button variant="ghost" onClick={() => { setStep(0); setJobId(null); setBulkStatus(null); setError(undefined); }}>
                {t("generateAnotherBtn")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={error}
        description={scope === "all"
          ? t.rich("confirmDescriptionAll", { strong: (chunks) => <strong>{chunks}</strong>, fy })
          : t.rich("confirmDescriptionOne", { strong: (chunks) => <strong>{chunks}</strong>, fy, employeeId: employeeId ?? "" })}
        onConfirm={() => void generateForm16()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </div>
  );
}
