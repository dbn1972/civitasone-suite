"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Card, ConfirmDialog, Button } from "../../../../_components/ds";
import { EmployeePicker } from "../../../../_components/EmployeePicker";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney, formatPeriod } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";

type RunType = "bonus" | "incentive" | "adhoc";

type ItemDraft = { _key: string; employeeId: string | null; employeeName: string | null; amountRupees: string };

type InvalidField = "period" | "items" | "duplicate" | null;

function emptyItem(): ItemDraft {
  return { _key: Math.random().toString(36).slice(2), employeeId: null, employeeName: null, amountRupees: "" };
}

/**
 * GAP-PAYROLL-OFF-CYCLE-03: rupees -> paise by string arithmetic (no
 * parseFloat * 100): "1.005", "1e3" and non-positive values are null.
 */
function itemMinor(it: ItemDraft): bigint | null {
  const minor = rupeesToMinorString(it.amountRupees);
  if (minor === null || BigInt(minor) > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return BigInt(minor);
}

/** GAP-PAYROLL-OFF-CYCLE-02: indexes of rows whose employee already appears earlier. */
export function duplicateEmployeeRows(items: ReadonlyArray<{ employeeId: string | null }>): Set<number> {
  const seen = new Set<string>();
  const dupes = new Set<number>();
  items.forEach((it, i) => {
    if (!it.employeeId) return;
    if (seen.has(it.employeeId)) dupes.add(i);
    else seen.add(it.employeeId);
  });
  return dupes;
}

const fieldStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;

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
  // UX-017: which field the current error is about, tracked as its own
  // identity -- never re-derived from the translated message text.
  const [invalidField, setInvalidField] = useState<InvalidField>(null);

  const periodId = useId();
  const descId = useId();
  const runTypeId = useId();
  const errId = useId();
  const periodRef = useRef<HTMLInputElement>(null);

  const periodInvalid = tone === "bad" && invalidField === "period";
  const itemsInvalid = tone === "bad" && (invalidField === "items" || invalidField === "duplicate");
  const dupes = duplicateEmployeeRows(items);

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(index: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  // BigInt sum: "0.1" + "0.2" totals exactly 30 paise.
  const totalAmountMinor = items.reduce((sum, it) => sum + (itemMinor(it) ?? 0n), 0n);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setInvalidField(null);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period.trim())) {
      setTone("bad");
      setInvalidField("period");
      setMessage(t("periodFormatError"));
      periodRef.current?.focus();
      return;
    }
    const firstInvalid = items.findIndex((it) => !it.employeeId || itemMinor(it) === null);
    if (firstInvalid >= 0) {
      setTone("bad");
      setInvalidField("items");
      setMessage(t("itemsValidationError"));
      document.getElementById(`${errId}-emp-${firstInvalid}`)?.focus();
      return;
    }
    if (dupes.size > 0) {
      setTone("bad");
      setInvalidField("duplicate");
      setMessage(t("duplicateEmployeeError"));
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createOffCycle() {
    setBusy(true);
    setDialogError(undefined);
    try {
      // CQRS: 202 { id, status: "accepted" } -- nothing to read back (the old
      // `res.data.itemCount` threw on every success).
      await browserJson<{ id: string; status: string }>("v1/payroll/off-cycle", {
        method: "POST",
        body: JSON.stringify({
          runType,
          period: period.trim(),
          description: description.trim() || undefined,
          items: items.map((it) => ({ employeeId: it.employeeId, amountMinor: Number(itemMinor(it)) })),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setInvalidField(null);
      setMessage(t("createdMessage", { period: formatPeriod(period.trim()), count: items.length, amount: formatMoney(totalAmountMinor) }));
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
    <form onSubmit={handleSubmit} noValidate style={{ marginBottom: 16 }}>
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
                style={fieldStyle}
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
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                aria-required="true"
                aria-invalid={periodInvalid || undefined}
                aria-describedby={periodInvalid ? errId : undefined}
                style={fieldStyle}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={descId} style={{ fontSize: 13, fontWeight: 600 }}>{t("descriptionLabel")}</label>
              <input
                id={descId}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={256}
                style={fieldStyle}
              />
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {t("itemsLabel")} <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </span>
            {items.map((it, index) => {
              const empFieldId = `${errId}-emp-${index}`;
              const amtFieldId = `${errId}-amt-${index}`;
              const amountBad = itemsInvalid && itemMinor(it) === null;
              const isDupe = dupes.has(index);
              return (
                <div key={it._key} style={{ display: "grid", gap: 4 }}>
                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <label htmlFor={empFieldId} style={{ fontSize: 12, fontWeight: 600 }}>{t("employeeLabel")}</label>
                      {/* GAP-PAYROLL-OFF-CYCLE-02: pick by name/code, never a raw UUID. */}
                      <EmployeePicker
                        id={empFieldId}
                        value={it.employeeId}
                        onChange={(id, option) => updateItem(index, { employeeId: id, employeeName: option?.label ?? null })}
                      />
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <label htmlFor={amtFieldId} style={{ fontSize: 12, fontWeight: 600 }}>{t("amountLabel")}</label>
                      <input
                        id={amtFieldId}
                        inputMode="decimal"
                        value={it.amountRupees}
                        onChange={(e) => updateItem(index, { amountRupees: e.target.value })}
                        aria-required="true"
                        aria-invalid={amountBad || undefined}
                        aria-describedby={amountBad ? errId : undefined}
                        style={fieldStyle}
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
                  {isDupe && (
                    <span role="alert" style={{ fontSize: 12, color: "var(--bad, #c0392b)" }}>
                      {t("duplicateEmployeeRowError")}
                    </span>
                  )}
                </div>
              );
            })}
            <div>
              <Button variant="ghost" onClick={addItem} style={{ minHeight: 44 }}>
                {t("addItemBtn")}
              </Button>
            </div>
          </div>

          {totalAmountMinor > 0n && (
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
        description={
          <>
            {t.rich("confirmDescription", {
              runType: t(runType === "bonus" ? "runTypeBonusOption" : runType === "incentive" ? "runTypeIncentiveOption" : "runTypeAdhocOption"),
              period: formatPeriod(period),
              count: items.length,
              amount: formatMoney(totalAmountMinor),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
            {/* GAP-PAYROLL-OFF-CYCLE-02: who is being paid, by name, before creating the run. */}
            <ul style={{ margin: "10px 0 0", paddingLeft: 18, maxHeight: 200, overflowY: "auto" }} aria-label={t("confirmItemsAriaLabel")}>
              {items.map((it) => (
                <li key={it._key}>
                  {it.employeeName ?? it.employeeId} — {formatMoney(itemMinor(it) ?? 0n)}
                </li>
              ))}
            </ul>
          </>
        }
        onConfirm={() => void createOffCycle()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
