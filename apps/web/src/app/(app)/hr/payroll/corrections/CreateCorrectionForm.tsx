"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type CreateResponse = {
  data: {
    id: string;
    employeeId: string;
    component: string;
    effectiveFrom: string;
    affectedPeriods: number;
    arrearsMinor: number;
    status: string;
  };
};

type InvalidField = "emp" | "comp" | "date" | "old" | "new" | null;

export function CreateCorrectionForm() {
  const t = useTranslations("createCorrectionForm");
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [component, setComponent] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [oldValue, setOldValue] = useState("");
  const [newValue, setNewValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  // UX-017: which field the current error message is about, tracked as its
  // own identity instead of re-testing `message` against hardcoded English
  // text. Before this change, `xxxInvalid` matched the live `message` state
  // against literals (`message === "Employee ID is required."`,
  // `message.startsWith("Old value")`); once `message` holds
  // `t("employeeIdRequiredError")`, that still happens to match under the
  // English locale (the translated string is byte-identical to the old
  // hardcoded one) but would silently and permanently evaluate false under
  // any other locale, since the comparison's right-hand side stays
  // hardcoded English — the same "translated text used for logic/identity"
  // bug class this gap's tranche 5/10 found in Segmented tab arrays, just
  // shaped as form-validation state instead of tab selection. Same fix
  // applied in CreateOffCycleForm.tsx (periodInvalid/itemsInvalid).
  const [invalidField, setInvalidField] = useState<InvalidField>(null);

  const empId = useId();
  const compId = useId();
  const dateId = useId();
  const oldId = useId();
  const newId = useId();
  const reasonId = useId();
  const errId = useId();

  const empRef = useRef<HTMLInputElement>(null);
  const compRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const oldRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);

  const empInvalid = tone === "bad" && invalidField === "emp";
  const compInvalid = tone === "bad" && invalidField === "comp";
  const dateInvalid = tone === "bad" && invalidField === "date";
  const oldInvalid = tone === "bad" && invalidField === "old";
  const newInvalid = tone === "bad" && invalidField === "new";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    if (!employeeId.trim()) {
      setTone("bad");
      setInvalidField("emp");
      setMessage(t("employeeIdRequiredError"));
      empRef.current?.focus();
      return;
    }
    if (!component.trim()) {
      setTone("bad");
      setInvalidField("comp");
      setMessage(t("componentRequiredError"));
      compRef.current?.focus();
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom.trim())) {
      setTone("bad");
      setInvalidField("date");
      setMessage(t("effectiveFromFormatError"));
      dateRef.current?.focus();
      return;
    }
    const oldRupees = parseFloat(oldValue);
    if (Number.isNaN(oldRupees) || oldRupees < 0) {
      setTone("bad");
      setInvalidField("old");
      setMessage(t("oldValueInvalidError"));
      oldRef.current?.focus();
      return;
    }
    const newRupees = parseFloat(newValue);
    if (Number.isNaN(newRupees) || newRupees < 0) {
      setTone("bad");
      setInvalidField("new");
      setMessage(t("newValueInvalidError"));
      newRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createCorrection() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const oldValueMinor = Math.round(parseFloat(oldValue) * 100);
      const newValueMinor = Math.round(parseFloat(newValue) * 100);
      const res = await browserJson<CreateResponse>("v1/payroll/corrections", {
        method: "POST",
        body: JSON.stringify({
          employeeId: employeeId.trim(),
          component: component.trim(),
          effectiveFrom: effectiveFrom.trim(),
          oldValueMinor,
          newValueMinor,
          reason: reason.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(
        t("recordedMessage", {
          component: component.trim(),
          count: res.data.affectedPeriods,
          arrears: formatMoney(res.data.arrearsMinor),
        }),
      );
      setEmployeeId("");
      setComponent("");
      setEffectiveFrom("");
      setOldValue("");
      setNewValue("");
      setReason("");
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
              <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("employeeIdLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={empId}
                ref={empRef}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                aria-required="true"
                aria-invalid={empInvalid || undefined}
                aria-describedby={empInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={compId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("componentLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={compId}
                ref={compRef}
                value={component}
                onChange={(e) => setComponent(e.target.value)}
                maxLength={32}
                placeholder={t("componentPlaceholder")}
                aria-required="true"
                aria-invalid={compInvalid || undefined}
                aria-describedby={compInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={dateId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("effectiveFromLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={dateId}
                ref={dateRef}
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                placeholder="2025-04-01"
                aria-required="true"
                aria-invalid={dateInvalid || undefined}
                aria-describedby={dateInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={oldId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("oldValueLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={oldId}
                ref={oldRef}
                type="number"
                min="0"
                step="0.01"
                value={oldValue}
                onChange={(e) => setOldValue(e.target.value)}
                aria-required="true"
                aria-invalid={oldInvalid || undefined}
                aria-describedby={oldInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={newId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("newValueLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={newId}
                ref={newRef}
                type="number"
                min="0"
                step="0.01"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                aria-required="true"
                aria-invalid={newInvalid || undefined}
                aria-describedby={newInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={reasonId} style={{ fontSize: 13, fontWeight: 600 }}>{t("reasonLabel")}</label>
              <input
                id={reasonId}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={512}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              {t("submitBtn")}
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
          component,
          employeeId,
          oldAmount: formatMoney(Math.round((parseFloat(oldValue) || 0) * 100)),
          newAmount: formatMoney(Math.round((parseFloat(newValue) || 0) * 100)),
          effectiveFrom,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void createCorrection()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
