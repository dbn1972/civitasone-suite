"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, ConfirmDialog, Button } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type RunType = "bonus" | "incentive" | "adhoc";

type ItemDraft = { _key: string; employeeId: string; amountRupees: string };

type CreateResponse = {
  data: { id: string; runType: string; period: string; totalAmountMinor: number; itemCount: number; status: string };
};

type InvalidField = "period" | "items" | null;

function emptyItem(): ItemDraft {
  return { _key: Math.random().toString(36).slice(2), employeeId: "", amountRupees: "" };
}

export function CreateOffCycleForm() {
  const t = useTranslations("createOffCycleForm");
  const router = useRouter();
  const [runType, setRunType] = useState<RunType>("bonus");
  const [period, setPeriod] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");
  // UX-017: same "translated text used as a logic identity" bug class as
  // CreateCorrectionForm.tsx's own invalidField fix (see its comment for the
  // full explanation) -- periodInvalid/itemsInvalid used to re-test the live
  // `message` state against hardcoded English literals
  // (`message.startsWith("Period")` / `message.startsWith("Every off-cycle item")`),
  // which would silently stop matching under any non-English locale once
  // `message` holds translated text. Tracked here instead as its own
  // identity, independent of the display string.
  const [invalidField, setInvalidField] = useState<InvalidField>(null);

  const periodId = useId();
  const descId = useId();
  const runTypeId = useId();
  const errId = useId();
  const periodRef = useRef<HTMLInputElement>(null);
  const empRefs = useRef<(HTMLInputElement | null)[]>([]);

  const periodInvalid = tone === "bad" && invalidField === "period";
  const itemsInvalid = tone === "bad" && invalidField === "items";

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(index: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  const totalAmountMinor = items.reduce((sum, it) => {
    const rupees = parseFloat(it.amountRupees);
    return sum + (Number.isNaN(rupees) ? 0 : Math.round(rupees * 100));
  }, 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    if (!/^\d{4}-\d{2}$/.test(period.trim())) {
      setTone("bad");
      setInvalidField("period");
      setMessage(t("periodFormatError"));
      periodRef.current?.focus();
      return;
    }
    const allValid = items.every((it) => {
      const rupees = parseFloat(it.amountRupees);
      return it.employeeId.trim().length > 0 && !Number.isNaN(rupees) && rupees > 0;
    });
    if (!allValid) {
      setTone("bad");
      setInvalidField("items");
      setMessage(t("itemsValidationError"));
      const firstInvalid = items.findIndex((it) => {
        const rupees = parseFloat(it.amountRupees);
        return !(it.employeeId.trim().length > 0 && !Number.isNaN(rupees) && rupees > 0);
      });
      if (firstInvalid >= 0) empRefs.current[firstInvalid]?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createOffCycle() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<CreateResponse>("v1/payroll/off-cycle", {
        method: "POST",
        body: JSON.stringify({
          runType,
          period: period.trim(),
          description: description.trim() || undefined,
          items: items.map((it) => ({
            employeeId: it.employeeId.trim(),
            amountMinor: Math.round(parseFloat(it.amountRupees) * 100),
          })),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(
        t("createdMessage", {
          period: period.trim(),
          count: res.data.itemCount,
          amount: formatMoney(res.data.totalAmountMinor),
        }),
      );
      setPeriod("");
      setDescription("");
      setItems([emptyItem()]);
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
              <label htmlFor={runTypeId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("runTypeLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <select
                id={runTypeId}
                value={runType}
                onChange={(e) => setRunType(e.target.value as RunType)}
                aria-required="true"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              >
                <option value="bonus">{t("runTypeBonusOption")}</option>
                <option value="incentive">{t("runTypeIncentiveOption")}</option>
                <option value="adhoc">{t("runTypeAdhocOption")}</option>
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={periodId} style={{ fontSize: 13, fontWeight: 600 }}>
                {t("periodLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={periodId}
                ref={periodRef}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="2025-06"
                aria-required="true"
                aria-invalid={periodInvalid || undefined}
                aria-describedby={periodInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={descId} style={{ fontSize: 13, fontWeight: 600 }}>{t("descriptionLabel")}</label>
              <input
                id={descId}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={256}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {t("itemsLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </span>
            {items.map((it, index) => {
              const empLabelId = `${errId}-emp-${index}`;
              const amtLabelId = `${errId}-amt-${index}`;
              return (
                <div
                  key={it._key}
                  style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}
                >
                  <div style={{ display: "grid", gap: 6 }}>
                    <label htmlFor={empLabelId} style={{ fontSize: 12, fontWeight: 600 }}>{t("employeeIdLabel")}</label>
                    <input
                      id={empLabelId}
                      ref={(el) => { empRefs.current[index] = el; }}
                      value={it.employeeId}
                      onChange={(e) => updateItem(index, { employeeId: e.target.value })}
                      aria-required="true"
                      aria-invalid={itemsInvalid && !it.employeeId.trim() ? true : undefined}
                      aria-describedby={itemsInvalid && !it.employeeId.trim() ? errId : undefined}
                      style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                    />
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <label htmlFor={amtLabelId} style={{ fontSize: 12, fontWeight: 600 }}>{t("amountLabel")}</label>
                    <input
                      id={amtLabelId}
                      type="number"
                      min="0"
                      step="0.01"
                      value={it.amountRupees}
                      onChange={(e) => updateItem(index, { amountRupees: e.target.value })}
                      aria-required="true"
                      aria-invalid={itemsInvalid && !(parseFloat(it.amountRupees) > 0) ? true : undefined}
                      aria-describedby={itemsInvalid && !(parseFloat(it.amountRupees) > 0) ? errId : undefined}
                      style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => removeItem(index)}
                    disabled={items.length === 1}
                    aria-label={t("removeItemAriaLabel", { index: index + 1 })}
                    style={{ minHeight: 44 }}
                  >
                    {t("removeBtn")}
                  </Button>
                </div>
              );
            })}
            <div>
              <Button variant="ghost" onClick={addItem} style={{ minHeight: 44 }}>
                {t("addItemBtn")}
              </Button>
            </div>
          </div>

          {totalAmountMinor > 0 && (
            <p style={{ fontSize: 13, color: "var(--ink2)" }}>
              {t.rich("totalAmountSummary", {
                amount: formatMoney(totalAmountMinor),
                count: items.length,
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          )}

          <div>
            <Button type="submit" style={{ minHeight: 44 }} disabled={busy} loading={busy}>
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
          runType,
          period,
          count: items.length,
          amount: formatMoney(totalAmountMinor),
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
        onConfirm={() => void createOffCycle()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
