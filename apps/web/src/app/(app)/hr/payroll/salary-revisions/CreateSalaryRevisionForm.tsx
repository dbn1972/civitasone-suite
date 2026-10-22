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
 * salary write belongs on this screen at all (vs. a read-only screen that
 * defers to HRMS pay-fixation) is a product decision still OPEN -- see the
 * ledger entry; the form is kept, restricted to PAYROLL_ADMIN_ROLES by
 * page.tsx. Independent of that decision, this form: parses rupees with the
 * paise-safe decimal-string parser (parseRupeesToMinor, no float), requires
 * the sanctioning order number, and captures the maker's REASON in the
 * ConfirmDialog (min 10 chars) which travels with the command to the audit
 * trail. The revision is then 'pending' until a different payroll user
 * approves it (maker-checker, GAP-PAYROLL-SALARY-REVISIONS-04). Cross-checking
 * the typed old/new basic against HRMS and any pay-matrix rule are owner
 * decisions that are NOT implemented here (no pay-matrix table or policy
 * threshold exists in the repo to check against).
 */
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, EntityPicker, Field, Input, Select } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { parseRupeesToMinor } from "@/lib/money";
import { searchEmployees, resolveEmployees } from "@/lib/entityAdapters/employee";
import { REVISION_TYPES, REVISION_TYPE_FORM_LABEL_KEYS, type RevisionType } from "@/lib/payroll/revisionTypes";

/**
 * The API takes JSON numbers, which are IEEE doubles: a paise figure above 2^53-1 would be
 * rounded silently on the wire. Larger figures are refused here (the API refuses them too).
 */
const MAX_WIRE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

type InvalidField = "employeeId" | "orderNo" | "effectiveDate" | "oldBasic" | "newBasic" | "oldGross" | "newGross" | null;

/**
 * `secondApprover` (GAP-PAYROLL-SALARY-REVISIONS-04): the tenant's maker !=
 * checker switch (default ON). When ON a submitted revision is 'pending' until
 * another payroll user approves it, and the confirmation says so; when OFF it
 * takes effect once processed.
 */
export function CreateSalaryRevisionForm({ secondApprover = true }: { secondApprover?: boolean } = {}) {
  const t = useTranslations("createSalaryRevisionForm");
  const tv = useTranslations("hrFormErrors2");
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
    const oldBasicMinor = parseRupeesToMinor(oldBasic, { allowZero: true });
    if (oldBasicMinor === null) {
      fail("oldBasic", t("oldBasicRequiredError"), oldBasicRef);
      return;
    }
    const newBasicMinor = parseRupeesToMinor(newBasic);
    if (newBasicMinor === null) {
      fail("newBasic", t("newBasicRequiredError"), newBasicRef);
      return;
    }
    const oldGrossMinor = parseRupeesToMinor(oldGross, { allowZero: true });
    if (oldGrossMinor === null) {
      fail("oldGross", t("oldGrossRequiredError"), oldGrossRef);
      return;
    }
    const newGrossMinor = parseRupeesToMinor(newGross);
    if (newGrossMinor === null) {
      fail("newGross", t("newGrossRequiredError"), newGrossRef);
      return;
    }
    // Refuse a figure that Number() could not carry exactly (> 2^53-1 paise) instead of rounding it.
    if (oldBasicMinor > MAX_WIRE_MINOR) {
      fail("oldBasic", t("amountTooLargeError"), oldBasicRef);
      return;
    }
    if (newBasicMinor > MAX_WIRE_MINOR) {
      fail("newBasic", t("amountTooLargeError"), newBasicRef);
      return;
    }
    if (oldGrossMinor > MAX_WIRE_MINOR) {
      fail("oldGross", t("amountTooLargeError"), oldGrossRef);
      return;
    }
    if (newGrossMinor > MAX_WIRE_MINOR) {
      fail("newGross", t("amountTooLargeError"), newGrossRef);
      return;
    }

    // GAP-PAYROLL-SALARY-REVISIONS-03: previously unvalidated -- a "new"
    // amount below the "old" one (other than an explicit correction, which
    // exists precisely to fix a wrongly-recorded figure) almost certainly
    // means the clerk swapped old/new or mistyped a digit.
    if (revisionType !== "correction" && newBasicMinor < oldBasicMinor) {
      fail("newBasic", t("newBasicBelowOldError"), newBasicRef);
      return;
    }
    if (newGrossMinor < newBasicMinor) {
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

    // The API takes JSON integers; Number() is exact because every figure was bounded
    // to <= Number.MAX_SAFE_INTEGER paise above, and it only happens here, at the wire edge.
    setPending({
      oldBasicMinor: Number(oldBasicMinor),
      newBasicMinor: Number(newBasicMinor),
      oldGrossMinor: Number(oldGrossMinor),
      newGrossMinor: Number(newGrossMinor),
    });
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createSalaryRevision(reason: string | undefined) {
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
          // GAP-PAYROLL-SALARY-REVISIONS-02: the maker's stated reason is written
          // to the audit trail with the revision (the ConfirmDialog requires it).
          ...(reason ? { reason } : {}),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      // Built from local form state, not the response body -- the accepted-
      // envelope's `data` field is optional and this route doesn't populate
      // it (see world-class-routes.ts / payroll/commands.ts createSalaryRevision).
      setMessage(
        t(secondApprover ? "recordedPendingMessage" : "recordedMessage", {
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
    <form noValidate onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <Field id={empPickerId} label={t("employeeIdLabel")} required>
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
            </Field>
            <Field id={dateId} label={t("effectiveDateLabel")} required error={dateInvalid ? tv("invalidValue") : undefined}>
              <Input
                ref={dateRef}
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </Field>
            <Field id={typeId} label={t("revisionTypeLabel")}>
              <Select
                value={revisionType}
                onChange={(e) => setRevisionType(e.target.value as RevisionType)}
              >
                {REVISION_TYPES.map((v) => (
                  <option key={v} value={v}>{REVISION_TYPE_LABELS[v]}</option>
                ))}
              </Select>
            </Field>
            <Field id={oldBasicId} label={t("oldBasicLabel")} required error={oldBasicInvalid ? tv("invalidValue") : undefined}>
              <Input
                ref={oldBasicRef}
                type="number"
                min="0"
                step="0.01"
                value={oldBasic}
                onChange={(e) => setOldBasic(e.target.value)}
              />
            </Field>
            <Field id={newBasicId} label={t("newBasicLabel")} required error={newBasicInvalid ? tv("invalidValue") : undefined}>
              <Input
                ref={newBasicRef}
                type="number"
                min="0"
                step="0.01"
                value={newBasic}
                onChange={(e) => setNewBasic(e.target.value)}
              />
            </Field>
            <Field id={oldGrossId} label={t("oldGrossLabel")} required error={oldGrossInvalid ? tv("invalidValue") : undefined}>
              <Input
                ref={oldGrossRef}
                type="number"
                min="0"
                step="0.01"
                value={oldGross}
                onChange={(e) => setOldGross(e.target.value)}
              />
            </Field>
            <Field id={newGrossId} label={t("newGrossLabel")} required error={newGrossInvalid ? tv("invalidValue") : undefined}>
              <Input
                ref={newGrossRef}
                type="number"
                min="0"
                step="0.01"
                value={newGross}
                onChange={(e) => setNewGross(e.target.value)}
              />
            </Field>
            <Field id={orderId} label={t("orderNoLabel")} required error={orderInvalid ? tv("fieldRequired") : undefined}>
              <Input
                ref={orderRef}
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                maxLength={64}
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

      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        confirmLabel={t("confirmLabel")}
        requireReason
        minReasonLength={10}
        maxReasonLength={512}
        reasonLabel={t("reasonLabel")}
        busy={busy}
        errorMessage={dialogError}
        description={t.rich("confirmDescription", {
          revisionType: REVISION_TYPE_LABELS[revisionType].toLowerCase(),
          amount: pending ? formatMoney(pending.newBasicMinor) : "",
          employeeId: employeeId ?? "",
          effectiveDate,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={(reason) => void createSalaryRevision(reason)}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
