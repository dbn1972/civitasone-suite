"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, Field, Input } from "../../../../_components/ds";
import { EmployeePicker } from "../../../../_components/EmployeePicker";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";

type InvalidField = "emp" | "comp" | "date" | "old" | "new" | null;

type PendingCorrection = {
  employeeId: string;
  component: string;
  effectiveFrom: string;
  oldValueMinor: number;
  newValueMinor: number;
};

/** Minimum length of the mandatory correction reason (ConfirmDialog gate). */
export const CORRECTION_REASON_MIN = 10;

/**
 * GAP-PAYROLL-CORRECTIONS-04: a REAL calendar date in YYYY-MM-DD -- the bare
 * regex accepted "2025-13-45" and "2026-02-30".
 */
export function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * GAP-PAYROLL-CORRECTIONS-03: rupees -> paise by string arithmetic (no
 * parseFloat * 100; "1e3", "12abc" and 3-decimal input are rejected). Zero is
 * a valid OLD/NEW value for a component the employee did not have.
 */
function toPaise(input: string): number | null {
  const minor = rupeesToMinorString(input, { allowZero: true });
  if (minor === null || BigInt(minor) > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}


export function CreateCorrectionForm() {
  const t = useTranslations("createCorrectionForm");
  const tv = useTranslations("hrFormErrors2");
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  const [component, setComponent] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [oldValue, setOldValue] = useState("");
  const [newValue, setNewValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingCorrection | null>(null);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  // UX-017: which field the current error is about, as its own identity
  // (never re-derived from the translated message text).
  const [invalidField, setInvalidField] = useState<InvalidField>(null);

  const empId = useId();
  const compId = useId();
  const dateId = useId();
  const oldId = useId();
  const newId = useId();
  const errId = useId();

  const compRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const oldRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);

  const isInvalid = (f: Exclude<InvalidField, null>) => tone === "bad" && invalidField === f;

  function fail(field: Exclude<InvalidField, null>, key: string, focus?: () => void) {
    setTone("bad");
    setInvalidField(field);
    setMessage(t(key));
    focus?.();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    // GAP-PAYROLL-CORRECTIONS-02: only an employee picked from the directory
    // can be corrected -- a mistyped/foreign UUID cannot reach the dialog.
    if (!employeeId) return fail("emp", "employeeIdRequiredError", () => document.getElementById(empId)?.focus());
    if (!component.trim()) return fail("comp", "componentRequiredError", () => compRef.current?.focus());
    if (!isRealIsoDate(effectiveFrom.trim())) return fail("date", "effectiveFromFormatError", () => dateRef.current?.focus());
    const oldValueMinor = toPaise(oldValue);
    if (oldValueMinor === null) return fail("old", "oldValueInvalidError", () => oldRef.current?.focus());
    const newValueMinor = toPaise(newValue);
    if (newValueMinor === null) return fail("new", "newValueInvalidError", () => newRef.current?.focus());
    setDialogError(undefined);
    setPending({ employeeId, component: component.trim(), effectiveFrom: effectiveFrom.trim(), oldValueMinor, newValueMinor });
  }

  async function createCorrection(reason?: string) {
    if (!pending) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      // CQRS: 202 { id, status: "accepted" } -- arrears/affected periods are
      // computed by the consumer, so they are not read from the response
      // (the old `res.data.affectedPeriods` threw on every success).
      await browserJson<{ id: string; status: string }>("v1/payroll/corrections", {
        method: "POST",
        body: JSON.stringify({ ...pending, reason: reason?.trim() }),
      });
      setPending(null);
      setTone("good");
      setInvalidField(null);
      setMessage(t("submittedMessage", { component: pending.component }));
      setEmployeeId(null);
      setEmployeeName(null);
      setComponent("");
      setEffectiveFrom("");
      setOldValue("");
      setNewValue("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <Field id={empId} label={t("employeeLabel")} required>
              <EmployeePicker
                id={empId}
                value={employeeId}
                onChange={(id, option) => { setEmployeeId(id); setEmployeeName(option?.label ?? null); }}
                clearable
              />
            </Field>
            <Field id={compId} label={t("componentLabel")} required error={isInvalid("comp") ? tv("fieldRequired") : undefined}>
              <Input
                ref={compRef}
                value={component}
                onChange={(e) => setComponent(e.target.value)}
                maxLength={32}
                placeholder={t("componentPlaceholder")}
              />
            </Field>
            <Field id={dateId} label={t("effectiveFromLabel")} required error={isInvalid("date") ? tv("invalidValue") : undefined}>
              {/* GAP-PAYROLL-CORRECTIONS-04: native date picker (value stays YYYY-MM-DD). */}
              <Input
                ref={dateRef}
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </Field>
            <Field id={oldId} label={t("oldValueLabel")} required error={isInvalid("old") ? tv("invalidValue") : undefined}>
              <Input
                ref={oldRef}
                inputMode="decimal"
                value={oldValue}
                onChange={(e) => setOldValue(e.target.value)}
              />
            </Field>
            <Field id={newId} label={t("newValueLabel")} required error={isInvalid("new") ? tv("invalidValue") : undefined}>
              <Input
                ref={newRef}
                inputMode="decimal"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
            </Field>
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

      {/* GAP-PAYROLL-CORRECTIONS-02: the dialog names the employee (not the
          UUID) and the reason is mandatory -- it is the record of why a
          retroactive pay change was made. */}
      <ConfirmDialog
        open={pending !== null}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        errorMessage={dialogError}
        requireReason
        reasonLabel={t("reasonLabel")}
        minReasonLength={CORRECTION_REASON_MIN}
        maxReasonLength={512}
        description={
          pending
            ? t.rich("confirmDescription", {
                component: pending.component,
                employee: employeeName ?? pending.employeeId,
                oldAmount: formatMoney(pending.oldValueMinor),
                newAmount: formatMoney(pending.newValueMinor),
                effectiveFrom: formatIndianDate(pending.effectiveFrom),
                strong: (chunks) => <strong>{chunks}</strong>,
              })
            : null
        }
        onConfirm={(reason) => void createCorrection(reason)}
        onCancel={() => !busy && setPending(null)}
      />
    </form>
  );
}
