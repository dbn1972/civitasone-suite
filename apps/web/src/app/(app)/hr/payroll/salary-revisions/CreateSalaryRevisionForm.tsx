"use client";

/**
 * HIGH fix: payroll-service's POST /v1/payroll/salary-revisions
 * (world-class-routes.ts) exists and works -- it publishes
 * payroll.salary_revision.create and the consumer persists it -- but had
 * zero UI callers. This page's own code comment used to claim "no create
 * route exists" (verified against world-class-routes.ts / gap-routes.ts /
 * repo.ts at the time), which was stale by the time this form was written.
 * Modeled directly on ../reimbursements/CreateReimbursementForm.tsx, the
 * closest existing analog (another CQRS-lifted list+create payroll screen).
 *
 * UX-017 (PR #1552 review): copy now reads through next-intl
 * (useTranslations("createSalaryRevisionForm")) instead of hardcoded English
 * -- same convention as ../off-cycle/CreateOffCycleForm.tsx and
 * ../corrections/CreateCorrectionForm.tsx. Field-invalidity is tracked as its
 * own `invalidField` identity rather than re-testing the live `message`
 * state against an English literal (`message === "Employee ID is
 * required."` etc.) -- the same "translated text used as a logic identity"
 * bug class CreateOffCycleForm.tsx's own invalidField fix already closed:
 * once `message` holds translated text, a hardcoded-English comparison
 * silently stops matching under any non-English locale, breaking
 * aria-invalid/aria-describedby for every non-English user.
 *
 * GAP-PAYROLL-SALARY-REVISIONS-02: whether a manual, free-text-employee
 * salary write belongs on this screen at all (vs. a read-only notice
 * pointing at HRMS pay-fixation, per en.json's own now-removed
 * readOnlyNotice copy) is a product decision this fixer is explicitly not
 * making -- see the PR description. What's fixed here are bugs independent
 * of that decision: the float-based money parsing, the free-text employee
 * UUID, and missing cross-field validation. Mandatory order number/reason
 * and a maker-checker approval step (this form's other two fix steps) stay
 * open for the same reason -- they only make sense once "should manual
 * entry exist" is answered.
 */
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, EntityPicker } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { REVISION_TYPES, REVISION_TYPE_FORM_LABEL_KEYS, type RevisionType } from "@/lib/payroll/revisionTypes";

type InvalidField = "employeeId" | "orderNo" | "effectiveDate" | "oldBasic" | "newBasic" | "oldGross" | "newGross" | null;

export function CreateSalaryRevisionForm() {
  const t = useTranslations("createSalaryRevisionForm");
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [revisionType, setRevisionType] = useState<RevisionType>("annual_increment");
  const [oldBasic, setOldBasic] = useState("");
  const [newBasic, setNewBasic] = useState("");
  const [oldGross, setOldGross] = useState("");
  const [newGross, setNewGross] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [invalidField, setInvalidField] = useState<InvalidField>(null);
  // Set only on a successful validation pass, consumed by createSalaryRevision --
  // avoids re-parsing (and potentially re-rejecting differently) the same
  // strings twice between handleSubmit's checks and the actual POST.
  const [pending, setPending] = useState<{ oldBasicMinor: number; newBasicMinor: number; oldGrossMinor: number; newGrossMinor: number } | null>(null);

  const dateId = useId();
  const typeId = useId();
  const oldBasicId = useId();
  const newBasicId = useId();
  const oldGrossId = useId();
  const newGrossId = useId();
  const orderId = useId();
  const errId = useId();
  const empPickerId = useId();
  const dateRef = useRef<HTMLInputElement>(null);
  const oldBasicRef = useRef<HTMLInputElement>(null);
  const newBasicRef = useRef<HTMLInputElement>(null);
  const oldGrossRef = useRef<HTMLInputElement>(null);
  const newGrossRef = useRef<HTMLInputElement>(null);
  const orderRef = useRef<HTMLInputElement>(null);

  const REVISION_TYPE_LABELS: Record<RevisionType, string> = {
    annual_increment: t(REVISION_TYPE_FORM_LABEL_KEYS.annual_increment),
    promotion: t(REVISION_TYPE_FORM_LABEL_KEYS.promotion),
    correction: t(REVISION_TYPE_FORM_LABEL_KEYS.correction),
    fitment: t(REVISION_TYPE_FORM_LABEL_KEYS.fitment),
  };

  const dateInvalid = tone === "bad" && invalidField === "effectiveDate";
  const oldBasicInvalid = tone === "bad" && invalidField === "oldBasic";
  const newBasicInvalid = tone === "bad" && invalidField === "newBasic";
  const oldGrossInvalid = tone === "bad" && invalidField === "oldGross";
  const newGrossInvalid = tone === "bad" && invalidField === "newGross";
  const orderInvalid = tone === "bad" && invalidField === "orderNo";

  function fail(field: InvalidField, msg: string, ref?: React.RefObject<HTMLInputElement>) {
    setTone("bad");
    setInvalidField(field);
    setMessage(msg);
    ref?.current?.focus();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);

    if (!employeeId) {
      fail("employeeId", t("employeeIdRequiredError"));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate.trim())) {
      fail("effectiveDate", t("effectiveDateFormatError"), dateRef);
      return;
    }

    // GAP-PAYROLL-SALARY-REVISIONS-02: `Math.round(parseFloat(v) * 100)`
    // mis-rounds values like 1.005 (float multiplication, not the paise-safe
    // string parser money.ts exists specifically to avoid -- see its own
    // doc comment). It rejects negatives and garbage, closing the old "blank
    // old-field silently becomes 0" gap: old basic/gross are required fields
    // below, not optional. PR #1756 review (M1): the OLD figures accept an
    // explicit 0 (allowZero) -- matching the backend's nonnegative() for
    // oldBasicMinor/oldGrossMinor and the error copy's "0 if there truly was
    // none" -- while the NEW figures stay strictly positive (backend positive()).
    const oldBasicMinor = rupeesToMinorString(oldBasic, { allowZero: true });
    if (oldBasicMinor === null) {
      fail("oldBasic", t("oldBasicRequiredError"), oldBasicRef);
      return;
    }
    const newBasicMinor = rupeesToMinorString(newBasic);
    if (newBasicMinor === null) {
      fail("newBasic", t("newBasicRequiredError"), newBasicRef);
      return;
    }
    const oldGrossMinor = rupeesToMinorString(oldGross, { allowZero: true });
    if (oldGrossMinor === null) {
      fail("oldGross", t("oldGrossRequiredError"), oldGrossRef);
      return;
    }
    const newGrossMinor = rupeesToMinorString(newGross);
    if (newGrossMinor === null) {
      fail("newGross", t("newGrossRequiredError"), newGrossRef);
      return;
    }

    // GAP-PAYROLL-SALARY-REVISIONS-03: previously unvalidated -- a "new"
    // amount below the "old" one (other than an explicit correction, which
    // exists precisely to fix a wrongly-recorded figure) almost certainly
    // means the clerk swapped old/new or mistyped a digit.
    if (revisionType !== "correction" && BigInt(newBasicMinor) < BigInt(oldBasicMinor)) {
      fail("newBasic", t("newBasicBelowOldError"), newBasicRef);
      return;
    }
    if (BigInt(newGrossMinor) < BigInt(newBasicMinor)) {
      fail("newGross", t("newGrossBelowBasicError"), newGrossRef);
      return;
    }

    // GAP-PAYROLL-SALARY-REVISIONS-02: a pay revision flows straight into HRMS
    // basic pay, so it must cite the sanctioning order (conservative default;
    // the manual-entry vs pay-fixation / maker-checker policy stays a human call).
    if (orderNo.trim() === "") {
      fail("orderNo", t("orderNoRequiredError"), orderRef);
      return;
    }

    setPending({
      oldBasicMinor: Number(oldBasicMinor),
      newBasicMinor: Number(newBasicMinor),
      oldGrossMinor: Number(oldGrossMinor),
      newGrossMinor: Number(newGrossMinor),
    });
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createSalaryRevision() {
    if (!pending || !employeeId) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson<{ id: string; status: string }>("v1/payroll/salary-revisions", {
        method: "POST",
        body: JSON.stringify({
          employeeId,
          effectiveDate: effectiveDate.trim(),
          revisionType,
          oldBasicMinor: pending.oldBasicMinor,
          newBasicMinor: pending.newBasicMinor,
          oldGrossMinor: pending.oldGrossMinor,
          newGrossMinor: pending.newGrossMinor,
          orderNo: orderNo.trim(),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      // Built from local form state, not the response body -- the accepted-
      // envelope's `data` field is optional and this route doesn't populate
      // it (see world-class-routes.ts / payroll/commands.ts createSalaryRevision).
      setMessage(
        t("recordedMessage", {
          amount: formatMoney(pending.newBasicMinor),
          employeeId,
        }),
      );
      setEmployeeId(null);
      setEffectiveDate("");
      setOldBasic("");
      setNewBasic("");
      setOldGross("");
      setNewGross("");
      setOrderNo("");
      setPending(null);
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
              <label htmlFor={empPickerId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("employeeIdLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              {/* GAP-PAYROLL-SALARY-REVISIONS-03: employee_id used to be a
                  bare free-text input -- no validation beyond non-empty, and
                  the backend requires a real UUID anyway. EntityPicker (and
                  its employee search/resolve adapters) is shared, existing
                  infra -- see hr/employees' own usage. */}
              <EntityPicker
                id={empPickerId}
                value={employeeId}
                onChange={(v) => setEmployeeId(Array.isArray(v) ? (v[0] ?? null) : v)}
                search={searchEmployees}
                resolve={resolveEmployees}
                placeholder={t("employeeIdPlaceholder")}
                aria-label={t("employeeIdLabel")}
              />
              {/* EntityPickerProps has no aria-invalid/aria-describedby of
                  its own yet -- the shared role="alert" message area below
                  (same one every other field in this form uses) still
                  announces the error; only the per-field red-border/
                  aria-invalid treatment the other fields get is unavailable
                  here until EntityPicker grows that. */}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={dateId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("effectiveDateLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={dateId}
                ref={dateRef}
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                aria-required="true"
                aria-invalid={dateInvalid || undefined}
                aria-describedby={dateInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={typeId} style={{ fontSize: 13, fontWeight: 600 }}>{t("revisionTypeLabel")}</label>
              <select
                id={typeId}
                value={revisionType}
                onChange={(e) => setRevisionType(e.target.value as RevisionType)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "#fff" }}
              >
                {REVISION_TYPES.map((v) => (
                  <option key={v} value={v}>{REVISION_TYPE_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={oldBasicId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("oldBasicLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={oldBasicId}
                ref={oldBasicRef}
                type="number"
                min="0"
                step="0.01"
                value={oldBasic}
                onChange={(e) => setOldBasic(e.target.value)}
                aria-required="true"
                aria-invalid={oldBasicInvalid || undefined}
                aria-describedby={oldBasicInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={newBasicId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("newBasicLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={newBasicId}
                ref={newBasicRef}
                type="number"
                min="0"
                step="0.01"
                value={newBasic}
                onChange={(e) => setNewBasic(e.target.value)}
                aria-required="true"
                aria-invalid={newBasicInvalid || undefined}
                aria-describedby={newBasicInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={oldGrossId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("oldGrossLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={oldGrossId}
                ref={oldGrossRef}
                type="number"
                min="0"
                step="0.01"
                value={oldGross}
                onChange={(e) => setOldGross(e.target.value)}
                aria-required="true"
                aria-invalid={oldGrossInvalid || undefined}
                aria-describedby={oldGrossInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={newGrossId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("newGrossLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={newGrossId}
                ref={newGrossRef}
                type="number"
                min="0"
                step="0.01"
                value={newGross}
                onChange={(e) => setNewGross(e.target.value)}
                aria-required="true"
                aria-invalid={newGrossInvalid || undefined}
                aria-describedby={newGrossInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={orderId} style={{ fontSize: 13, fontWeight: 600 }}>{t("orderNoLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span></label>
              <input
                id={orderId}
                ref={orderRef}
                aria-required="true"
                aria-invalid={orderInvalid || undefined}
                aria-describedby={orderInvalid ? errId : undefined}
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                maxLength={64}
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
          revisionType: REVISION_TYPE_LABELS[revisionType].toLowerCase(),
          amount: pending ? formatMoney(pending.newBasicMinor) : "",
          employeeId: employeeId ?? "",
          effectiveDate,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void createSalaryRevision()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
