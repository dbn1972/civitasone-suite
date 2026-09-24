"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, ConfirmDialog, Button } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { currentFinancialYear } from "@/lib/fiscalYear";

type ElectionLine = { component: string; amount: string };
type ElectionResponse = { data: { id: string; planId: string; fy: string; totalElectedMinor: number } };

const emptyLine = (): ElectionLine => ({ component: "", amount: "" });

export function ElectFlexBenefitForm() {
  const t = useTranslations("electFlexBenefitForm");
  const router = useRouter();
  const [planId, setPlanId] = useState("");
  // Default to the current FY — matches CreateFlexPlanForm and avoids
  // requiring the employee to type an exact "YYYY-YY" string by hand.
  const [fy, setFy] = useState(currentFinancialYear);
  const [lines, setLines] = useState<ElectionLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const planIdField = useId();
  const fyId = useId();
  const errId = useId();
  const planRef = useRef<HTMLInputElement>(null);
  const fyRef = useRef<HTMLInputElement>(null);
  const lineComponentRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Stable per-row React key, independent of array position -- see
  // LineItemsEditor.tsx (apps/web/src/app/(app)/procurement/_components) for
  // the full rationale: keying by index let removing an earlier line shift
  // a later, focused one up into a different key, so React patched the
  // focused DOM node in place with the wrong line's data instead of
  // removing the right node and leaving the rest (and focus) alone.
  // ElectionLine itself carries no id and stays that way (it's just
  // { component, amount}, mapped straight into the submit payload) -- a
  // parallel id list, generated once per row and advanced only by the three
  // places `lines`'s length actually changes (addLine/removeLine/resetLines
  // below), keeps every row's key stable across edits.
  const nextLineRowId = useRef(0);
  const [lineRowIds, setLineRowIds] = useState<number[]>(() => [nextLineRowId.current++]);
  const lineKeyFor = (idx: number) => lineRowIds[idx] ?? idx;

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
    setLineRowIds((ids) => [...ids, nextLineRowId.current++]);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
    setLineRowIds((ids) => ids.filter((_, i) => i !== idx));
  }
  function resetLines() {
    setLines([emptyLine()]);
    setLineRowIds([nextLineRowId.current++]);
  }

  const [invalidField, setInvalidField] = useState<"planId" | "fy" | "lines" | null>(null);
  const planInvalid = tone === "bad" && invalidField === "planId";
  const fyInvalid = tone === "bad" && invalidField === "fy";
  const lineGroupInvalid = tone === "bad" && invalidField === "lines";

  function isLineInvalid(l: ElectionLine): boolean {
    if (!lineGroupInvalid) return false;
    return !l.component.trim() || Number.isNaN(parseFloat(l.amount)) || parseFloat(l.amount) < 0;
  }

  function updateLine(idx: number, patch: Partial<ElectionLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  const totalMinor = lines.reduce((sum, l) => {
    const amt = parseFloat(l.amount);
    return sum + (Number.isNaN(amt) ? 0 : Math.round(amt * 100));
  }, 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    if (!planId.trim()) {
      setTone("bad");
      setInvalidField("planId");
      setMessage(t("planIdRequiredError"));
      planRef.current?.focus();
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(fy.trim())) {
      setTone("bad");
      setInvalidField("fy");
      setMessage(t("fyFormatError"));
      fyRef.current?.focus();
      return;
    }
    const validLines = lines.filter((l) => l.component.trim());
    const firstInvalidIdx = lines.findIndex(
      (l) => !l.component.trim() || Number.isNaN(parseFloat(l.amount)) || parseFloat(l.amount) < 0,
    );
    if (validLines.length === 0 || validLines.some((l) => Number.isNaN(parseFloat(l.amount)) || parseFloat(l.amount) < 0)) {
      setTone("bad");
      setInvalidField("lines");
      setMessage(t("linesRequiredError"));
      if (firstInvalidIdx >= 0) lineComponentRefs.current[firstInvalidIdx]?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submitElection() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<ElectionResponse>("v1/payroll/flex-benefits/elections", {
        method: "POST",
        body: JSON.stringify({
          planId: planId.trim(),
          fy: fy.trim(),
          elections: lines
            .filter((l) => l.component.trim())
            .map((l) => ({ component: l.component.trim(), electedMinor: Math.round(parseFloat(l.amount) * 100) })),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(t("submittedMessage", { amount: formatMoney(res.data.totalElectedMinor) }));
      setPlanId("");
      resetLines();
      router.refresh();
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
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={planIdField} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("planIdLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={planIdField}
                ref={planRef}
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                aria-required="true"
                aria-invalid={planInvalid || undefined}
                aria-describedby={planInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
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
                aria-invalid={fyInvalid || undefined}
                aria-describedby={fyInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
            <legend style={{ fontSize: 13, fontWeight: 600, padding: "0 4px" }}>
              {t("electionsLegend")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </legend>
            <div style={{ display: "grid", gap: 10 }}>
              {lines.map((l, idx) => {
                const compId = `${planIdField}-line-${idx}-comp`;
                const amtId = `${planIdField}-line-${idx}-amt`;
                const rowInvalid = isLineInvalid(l);
                return (
                  <div key={lineKeyFor(idx)} style={{ display: "grid", gap: 10, gridTemplateColumns: "2fr 1fr auto", alignItems: "end" }}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <label htmlFor={compId} style={{ fontSize: 12 }}>{t("componentLabel")}</label>
                      <input
                        id={compId}
                        ref={(el) => { lineComponentRefs.current[idx] = el; }}
                        value={l.component}
                        aria-invalid={rowInvalid || undefined}
                        aria-describedby={rowInvalid ? errId : undefined}
                        onChange={(e) => updateLine(idx, { component: e.target.value })}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40 }}
                      />
                    </div>
                    <div style={{ display: "grid", gap: 4 }}>
                      <label htmlFor={amtId} style={{ fontSize: 12 }}>{t("electedAmountLabel")}</label>
                      <input
                        id={amtId}
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.amount}
                        aria-invalid={rowInvalid || undefined}
                        aria-describedby={rowInvalid ? errId : undefined}
                        onChange={(e) => updateLine(idx, { amount: e.target.value })}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40 }}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      style={{ minHeight: 40 }}
                      aria-label={l.component ? t("removeLineNamedAriaLabel", { index: idx + 1, name: l.component }) : t("removeLineAriaLabel", { index: idx + 1 })}
                      onClick={() => removeLine(idx)}
                      disabled={lines.length === 1}
                    >
                      {t("removeBtn")}
                    </Button>
                  </div>
                );
              })}
              <div>
                <Button
                  variant="ghost"
                  style={{ minHeight: 40 }}
                  onClick={addLine}
                >
                  {t("addLineBtn")}
                </Button>
              </div>
            </div>
          </fieldset>

          <p style={{ fontSize: 13, color: "var(--ink2)" }}>
            {t.rich("totalElectedText", { amount: formatMoney(totalMinor), strong: (chunks) => <strong>{chunks}</strong> })}
          </p>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy} loading={busy}>
              {t("submitElectionBtn")}
            </Button>
          </div>

          {message && (
            <p
              id={errId}
              role={tone === "bad" ? "alert" : "status"}
              aria-live={tone === "bad" ? undefined : "polite"}
              className={`pill ${tone}`}
              style={{ width: "fit-content" }}
            >
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={t.rich("confirmDescription", {
          amount: formatMoney(totalMinor),
          planId,
          fy,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void submitElection()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
