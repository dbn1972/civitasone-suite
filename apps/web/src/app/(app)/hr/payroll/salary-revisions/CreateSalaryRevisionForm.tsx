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
 */
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

const REVISION_TYPE_VALUES = ["annual_increment", "promotion", "correction", "fitment"] as const;
type RevisionType = (typeof REVISION_TYPE_VALUES)[number];

type InvalidField = "employeeId" | "effectiveDate" | "newBasic" | "newGross" | null;

export function CreateSalaryRevisionForm() {
  const t = useTranslations("createSalaryRevisionForm");
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
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

  const empId = useId();
  const dateId = useId();
  const typeId = useId();
  const oldBasicId = useId();
  const newBasicId = useId();
  const oldGrossId = useId();
  const newGrossId = useId();
  const orderId = useId();
  const errId = useId();
  const empRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const newBasicRef = useRef<HTMLInputElement>(null);
  const newGrossRef = useRef<HTMLInputElement>(null);

  const REVISION_TYPE_LABELS: Record<RevisionType, string> = {
    annual_increment: t("revisionTypeAnnualIncrementOption"),
    promotion: t("revisionTypePromotionOption"),
    correction: t("revisionTypeCorrectionOption"),
    fitment: t("revisionTypeFitmentOption"),
  };

  const empInvalid = tone === "bad" && invalidField === "employeeId";
  const dateInvalid = tone === "bad" && invalidField === "effectiveDate";
  const newBasicInvalid = tone === "bad" && invalidField === "newBasic";
  const newGrossInvalid = tone === "bad" && invalidField === "newGross";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    if (!employeeId.trim()) {
      setTone("bad");
      setInvalidField("employeeId");
      setMessage(t("employeeIdRequiredError"));
      empRef.current?.focus();
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate.trim())) {
      setTone("bad");
      setInvalidField("effectiveDate");
      setMessage(t("effectiveDateFormatError"));
      dateRef.current?.focus();
      return;
    }
    const newBasicRupees = parseFloat(newBasic);
    if (Number.isNaN(newBasicRupees) || newBasicRupees <= 0) {
      setTone("bad");
      setInvalidField("newBasic");
      setMessage(t("newBasicRequiredError"));
      newBasicRef.current?.focus();
      return;
    }
    const newGrossRupees = parseFloat(newGross);
    if (Number.isNaN(newGrossRupees) || newGrossRupees <= 0) {
      setTone("bad");
      setInvalidField("newGross");
      setMessage(t("newGrossRequiredError"));
      newGrossRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createSalaryRevision() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const toMinor = (v: string) => Math.round((parseFloat(v) || 0) * 100);
      await browserJson<{ id: string; status: string }>("v1/payroll/salary-revisions", {
        method: "POST",
        body: JSON.stringify({
          employeeId: employeeId.trim(),
          effectiveDate: effectiveDate.trim(),
          revisionType,
          oldBasicMinor: toMinor(oldBasic),
          newBasicMinor: toMinor(newBasic),
          oldGrossMinor: toMinor(oldGross),
          newGrossMinor: toMinor(newGross),
          orderNo: orderNo.trim() || undefined,
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
          amount: formatMoney(toMinor(newBasic)),
          employeeId: employeeId.trim(),
        }),
      );
      setEmployeeId("");
      setEffectiveDate("");
      setOldBasic("");
      setNewBasic("");
      setOldGross("");
      setNewGross("");
      setOrderNo("");
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
                {REVISION_TYPE_VALUES.map((v) => (
                  <option key={v} value={v}>{REVISION_TYPE_LABELS[v]}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={oldBasicId} style={{ fontSize: 13, fontWeight: 600 }}>{t("oldBasicLabel")}</label>
              <input
                id={oldBasicId}
                type="number"
                min="0"
                step="0.01"
                value={oldBasic}
                onChange={(e) => setOldBasic(e.target.value)}
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
              <label htmlFor={oldGrossId} style={{ fontSize: 13, fontWeight: 600 }}>{t("oldGrossLabel")}</label>
              <input
                id={oldGrossId}
                type="number"
                min="0"
                step="0.01"
                value={oldGross}
                onChange={(e) => setOldGross(e.target.value)}
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
              <label htmlFor={orderId} style={{ fontSize: 13, fontWeight: 600 }}>{t("orderNoLabel")}</label>
              <input
                id={orderId}
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
          amount: formatMoney(Math.round((parseFloat(newBasic) || 0) * 100)),
          employeeId,
          effectiveDate,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void createSalaryRevision()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
