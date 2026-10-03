"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, EmptyState } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { minorToDecimalString } from "@/lib/money";

const NATURES = [
  "accommodation", "car", "loan", "medical", "club_membership", "gas_electricity_water",
  "domestic_servant", "education", "gift", "other",
] as const;

// UX-017: the dropdown previously derived its display text from the raw
// NATURES key (`n.replace(/_/g, " ")`), which is scanner-blind (no JSX
// string literal) but still real hardcoded English -- translated here, same
// "beyond the scanner" object-literal treatment tranche 12 gave
// STATUTORY_CARDS.
// GAP-PAYROLL-STATUTORY-PERQUISITE-07: the saved-message/confirm-dialog copy
// below used to interpolate the raw `nature` key (e.g. "gas_electricity_water")
// instead of this label map -- now both use NATURE_LABEL_KEYS, so a saved
// component reads the same sentence-cased label everywhere.
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

/**
 * GAP-PAYROLL-STATUTORY-PERQUISITE-05 (fix step 4): employeeId/FY used to be
 * a SECOND, independently-editable copy of the same two fields the lookup
 * form above already collects -- the two could silently disagree (save a
 * component for a different employee/FY than the one currently displayed).
 * This form now has no employee/FY inputs of its own: it only ever acts on
 * the already-looked-up `defaultEmployeeId`/`defaultFy` (page.tsx's own
 * `employeeId`/`fy` searchParams), shown read-only, and is disabled entirely
 * until a lookup has happened.
 *
 * GAP-PAYROLL-STATUTORY-PERQUISITE-03: valueByEmployer/amountRecovered are
 * sent as plain rupee floats (unchanged) -- VERIFIED against payroll-
 * service's tax/consumer.ts perquisiteComponentUpsert handler, which does
 * `BigInt(Math.round(p.valueByEmployer * 100))` itself. The server expects
 * rupees under these exact (non-"Minor"-suffixed) field names and converts
 * server-side; sending pre-converted minor-unit integers under renamed
 * fields, as the original gap write-up suggested, would make the consumer
 * read `undefined` for both fields and throw (`BigInt(NaN)`). Left
 * unchanged -- this was a false positive in the original snapshot audit,
 * not a real unit mismatch.
 */
export function PerquisiteComponentForm({ defaultEmployeeId, defaultFy, editing }: {
  defaultEmployeeId: string;
  defaultFy: string;
  /** GAP-PAYROLL-STATUTORY-PERQUISITE-06: an existing line being corrected (nature is its key, so it is fixed). */
  editing?: { nature: string; description: string; valueByEmployerMinor: string; amountRecoveredMinor: string };
}) {
  const t = useTranslations("perquisiteComponentForm");
  const router = useRouter();
  const canSave = !!defaultEmployeeId && !!defaultFy;
  const editingNature = editing && (NATURES as readonly string[]).includes(editing.nature) ? (editing.nature as typeof NATURES[number]) : undefined;
  const [nature, setNature] = useState<typeof NATURES[number]>(editingNature ?? "accommodation");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [valueByEmployer, setValueByEmployer] = useState(editing ? (minorToDecimalString(editing.valueByEmployerMinor) ?? "") : "");
  const [amountRecovered, setAmountRecovered] = useState(
    editing && editing.amountRecoveredMinor !== "0" ? (minorToDecimalString(editing.amountRecoveredMinor) ?? "") : "",
  );
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  const [valueInvalid, setValueInvalid] = useState(false);

  const natureId = useId();
  const descId = useId();
  const valueId = useId();
  const recoveredId = useId();
  const errId = useId();
  const valueRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setValueInvalid(false);
    const value = parseFloat(valueByEmployer);
    if (Number.isNaN(value) || value < 0) {
      setTone("bad");
      setMessage(t("valueInvalidError"));
      setValueInvalid(true);
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
          employeeId: defaultEmployeeId,
          fy: defaultFy,
          nature,
          description: description.trim() || undefined,
          valueByEmployer: parseFloat(valueByEmployer),
          amountRecovered: amountRecovered.trim() ? parseFloat(amountRecovered) : undefined,
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(t("savedMessage", { nature: t(NATURE_LABEL_KEYS[nature]), employeeId: defaultEmployeeId }));
      setDescription(""); setValueByEmployer(""); setAmountRecovered("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  if (!canSave) {
    return (
      <Card title={t("formTitle")} padding>
        <EmptyState icon="🔍" title={t("noLookupTitle")} message={t("noLookupMessage")} />
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title={t("formTitle")} padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
            <div>
              <div style={{ color: "var(--ink2)" }}>{t("employeeIdLabel")}</div>
              <div style={{ fontWeight: 600 }}>{defaultEmployeeId}</div>
            </div>
            <div>
              <div style={{ color: "var(--ink2)" }}>{t("financialYearLabel")}</div>
              <div style={{ fontWeight: 600 }}>{defaultFy}</div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={natureId} style={{ fontSize: 13, fontWeight: 600 }}>{t("natureLabel")}</label>
              <select
                id={natureId}
                value={nature}
                onChange={(e) => setNature(e.target.value as typeof NATURES[number])}
                disabled={!!editingNature}
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

          {editingNature && (
            <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--ink2)" }}>{t("editingNotice")}</p>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy}>
              {editingNature ? t("updateBtn") : t("submitBtn")}
            </Button>
            {editingNature && (
              <a href={`/hr/payroll/statutory/perquisite?employeeId=${encodeURIComponent(defaultEmployeeId)}&fy=${encodeURIComponent(defaultFy)}`}>{t("cancelEdit")}</a>
            )}
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
              nature: t(NATURE_LABEL_KEYS[nature]),
              employeeId: defaultEmployeeId,
              fy: defaultFy,
              value: valueByEmployer || 0,
              recovered: amountRecovered,
            })
          : t.rich("confirmDescriptionBase", {
              strong: (chunks) => <strong>{chunks}</strong>,
              nature: t(NATURE_LABEL_KEYS[nature]),
              employeeId: defaultEmployeeId,
              fy: defaultFy,
              value: valueByEmployer || 0,
            })}
        onConfirm={() => void saveComponent()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
