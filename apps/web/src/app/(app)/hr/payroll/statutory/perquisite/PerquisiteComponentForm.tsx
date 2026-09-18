"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

const NATURES = [
  "accommodation", "car", "loan", "medical", "club_membership", "gas_electricity_water",
  "domestic_servant", "education", "gift", "other",
] as const;

// UX-017: the dropdown previously derived its display text from the raw
// NATURES key (`n.replace(/_/g, " ")`), which is scanner-blind (no JSX
// string literal) but still real hardcoded English -- translated here, same
// "beyond the scanner" object-literal treatment tranche 12 gave
// STATUTORY_CARDS. The saved-message/confirm-dialog copy below still
// interpolates the raw `nature` key (unchanged from before this tranche),
// not this label map, to avoid any behavior change beyond translation.
const NATURE_LABEL_KEYS: Record<(typeof NATURES)[number], string> = {
  accommodation: "natureAccommodation",
  car: "natureCar",
  loan: "natureLoan",
  medical: "natureMedical",
  club_membership: "natureClubMembership",
  gas_electricity_water: "natureGasElectricityWater",
  domestic_servant: "natureDomesticServant",
  education: "natureEducation",
  gift: "natureGift",
  other: "natureOther",
};

export function PerquisiteComponentForm({ defaultEmployeeId, defaultFy }: { defaultEmployeeId: string; defaultFy: string }) {
  const t = useTranslations("perquisiteComponentForm");
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [fy, setFy] = useState(defaultFy);
  const [nature, setNature] = useState<typeof NATURES[number]>("accommodation");
  const [description, setDescription] = useState("");
  const [valueByEmployer, setValueByEmployer] = useState("");
  const [amountRecovered, setAmountRecovered] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  // UX-017: message is now translated display text, so it can no longer be
  // compared/prefix-matched directly to decide which field is invalid (same
  // bug class as PtSlabForm.tsx/LwfConfigForm.tsx, tranche 12) -- invalidField
  // is a stable, untranslated identity kept separately from the display string.
  const [invalidField, setInvalidField] = useState<"employeeId" | "value" | null>(null);

  const empIdId = useId();
  const fyId = useId();
  const natureId = useId();
  const descId = useId();
  const valueId = useId();
  const recoveredId = useId();
  const errId = useId();
  const empIdRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const empIdInvalid = invalidField === "employeeId";
  const valueInvalid = invalidField === "value";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    if (!employeeId.trim() || !fy.trim()) {
      setTone("bad");
      setMessage(t("employeeFyRequiredError"));
      setInvalidField("employeeId");
      empIdRef.current?.focus();
      return;
    }
    const value = parseFloat(valueByEmployer);
    if (Number.isNaN(value) || value < 0) {
      setTone("bad");
      setMessage(t("valueInvalidError"));
      setInvalidField("value");
      valueRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function saveComponent() {
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson("v1/payroll/statutory/perquisite-components", {
        method: "POST",
        body: JSON.stringify({
          employeeId: employeeId.trim(),
          fy: fy.trim(),
          nature,
          description: description.trim() || undefined,
          valueByEmployer: parseFloat(valueByEmployer),
          amountRecovered: amountRecovered.trim() ? parseFloat(amountRecovered) : undefined,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(t("savedMessage", { nature, employeeId: employeeId.trim() }));
      setDescription(""); setValueByEmployer(""); setAmountRecovered("");
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
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={empIdId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("employeeIdLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={empIdId}
                ref={empIdRef}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                aria-required="true"
                aria-invalid={empIdInvalid || undefined}
                aria-describedby={empIdInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("financialYearLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={fyId}
                value={fy}
                onChange={(e) => setFy(e.target.value)}
                placeholder={t("financialYearPlaceholder")}
                aria-required="true"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={natureId} style={{ fontSize: 13, fontWeight: 600 }}>{t("natureLabel")}</label>
              <select
                id={natureId}
                value={nature}
                onChange={(e) => setNature(e.target.value as typeof NATURES[number])}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "#fff" }}
              >
                {NATURES.map((n) => (
                  <option key={n} value={n}>{t(NATURE_LABEL_KEYS[n])}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={descId} style={{ fontSize: 13, fontWeight: 600 }}>{t("descriptionLabel")}</label>
              <input
                id={descId}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={valueId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("valueByEmployerLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={valueId}
                ref={valueRef}
                type="number" min="0" step="0.01"
                value={valueByEmployer}
                onChange={(e) => setValueByEmployer(e.target.value)}
                aria-required="true"
                aria-invalid={valueInvalid || undefined}
                aria-describedby={valueInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={recoveredId} style={{ fontSize: 13, fontWeight: 600 }}>{t("amountRecoveredLabel")}</label>
              <input
                id={recoveredId}
                type="number" min="0" step="0.01"
                value={amountRecovered}
                onChange={(e) => setAmountRecovered(e.target.value)}
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
        description={amountRecovered
          ? t.rich("confirmDescriptionWithRecovered", {
              strong: (chunks) => <strong>{chunks}</strong>,
              nature,
              employeeId,
              fy,
              value: valueByEmployer || 0,
              recovered: amountRecovered,
            })
          : t.rich("confirmDescriptionBase", {
              strong: (chunks) => <strong>{chunks}</strong>,
              nature,
              employeeId,
              fy,
              value: valueByEmployer || 0,
            })}
        onConfirm={() => void saveComponent()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
