"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, DataTable, Field, Input, Modal, Select, Textarea } from "../../../_components/ds";
import { browserFetch, errorCodeFromResponse, errorMessageFromResponse } from "@/lib/api/browserClient";
import { todayIST } from "@/lib/formatters";
import {
  METER_TYPES, completeBody, isOpenJob, meterBody, validateComplete, validateMeter,
  type CompleteErrors, type MeterErrors, type MeterType,
} from "./jobForms";

export type MaintenanceJobRow = {
  id: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  maintenanceType: string;
  scheduledDate: string;
  vendor: string;
  status: string;
  journal: string;
};

type Dialog = { kind: "complete" | "meter"; row: MaintenanceJobRow } | null;

/**
 * UAT W4: preventive-maintenance completion. "Complete" -> PATCH
 * /v1/assets/work-orders/:id/complete (202, applied by the consumer, so the
 * list is refreshed and the status changes shortly); "Meter reading" ->
 * POST /v1/assets/assets/:id/meter-readings (202). Both are asset-service
 * ASSET_ROLES only (asset_manager / asset_admin / super_admin); `canAct` is a UX
 * gate, the service stays authoritative (403).
 */
export function MaintenanceJobs({ rows, canAct }: { rows: MaintenanceJobRow[]; canAct: boolean }) {
  const t = useTranslations("assetsLifecycle");
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState("");
  const [message, setMessage] = useState("");

  const [completedDate, setCompletedDate] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [cErrors, setCErrors] = useState<CompleteErrors>({});

  const [meterType, setMeterType] = useState<MeterType>("odometer");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("km");
  const [readingDate, setReadingDate] = useState("");
  const [mNotes, setMNotes] = useState("");
  const [mErrors, setMErrors] = useState<MeterErrors>({});

  function open(kind: "complete" | "meter", row: MaintenanceJobRow) {
    const today = todayIST();
    setServerError("");
    setCErrors({}); setMErrors({});
    setCompletedDate(today); setCost(""); setNotes("");
    setMeterType("odometer"); setValue(""); setUnit("km"); setReadingDate(today); setMNotes("");
    setDialog({ kind, row });
  }

  async function submit() {
    if (!dialog || busy) return;
    const today = todayIST();
    let path: string;
    let method: string;
    let body: unknown;
    if (dialog.kind === "complete") {
      const form = { completedDate, cost, notes };
      const errs = validateComplete(form, today);
      setCErrors(errs);
      if (Object.keys(errs).length) return;
      path = `v1/asset/work-orders/${encodeURIComponent(dialog.row.id)}/complete`;
      method = "PATCH";
      body = completeBody(form);
    } else {
      const form = { meterType, value, unit, readingDate, notes: mNotes };
      const errs = validateMeter(form, today);
      setMErrors(errs);
      if (Object.keys(errs).length) return;
      path = `v1/asset/assets/${encodeURIComponent(dialog.row.assetId)}/meter-readings`;
      method = "POST";
      body = meterBody(form);
    }
    setBusy(true);
    setServerError("");
    try {
      const res = await browserFetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const code = await errorCodeFromResponse(res);
        setServerError(code === "NOT_FOUND" ? t("errNotFound") : await errorMessageFromResponse(res));
        return;
      }
      // 202 Accepted: the consumer applies it asynchronously -- say "submitted", never "done".
      setMessage(
        dialog.kind === "complete"
          ? t("completeSubmitted", { asset: dialog.row.assetCode })
          : t("meterSubmitted", { asset: dialog.row.assetCode }),
      );
      setDialog(null);
      router.refresh();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setBusy(false);
    }
  }

  const columns: { key: keyof MaintenanceJobRow; label: string; cellType?: "status"; render?: (r: MaintenanceJobRow) => React.ReactNode }[] = [
    { key: "assetCode", label: "Asset code" },
    { key: "assetName", label: "Asset", render: (r) => <Link href={`/assets/${r.assetId}`}>{r.assetName}</Link> },
    { key: "maintenanceType", label: "Type" },
    { key: "scheduledDate", label: "Scheduled" },
    { key: "vendor", label: "Technician / Agency" },
    { key: "status", label: "Status", cellType: "status" },
    { key: "journal", label: t("journalColumn") },
  ];
  if (canAct) {
    columns.push({
      key: "id",
      label: t("actionsColumn"),
      render: (r) => (
        <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
          {isOpenJob(r.status) ? (
            <Button type="button" variant="secondary" size="sm" aria-label={t("completeAria", { type: r.maintenanceType, asset: r.assetCode })} onClick={() => open("complete", r)}>
              {t("complete")}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" size="sm" aria-label={t("meterAria", { asset: r.assetCode })} onClick={() => open("meter", r)}>
            {t("meterReading")}
          </Button>
        </span>
      ),
    });
  }

  return (
    <>
      {message ? <p role="status" className="pill good" style={{ width: "fit-content", marginBottom: 12 }}>{message}</p> : null}
      <DataTable<MaintenanceJobRow>
        columns={columns}
        rows={rows}
        identifyingColumnKey="assetName"
        sortable
        filterable
        filterPlaceholder="Filter jobs…"
        pageSize={15}
      />
      <Modal
        open={dialog !== null}
        onClose={() => !busy && setDialog(null)}
        closeOnOverlayClick={!busy}
        title={dialog?.kind === "meter" ? t("meterTitle") : t("completeTitle")}
      >
        {dialog ? (
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0 }}>
              <strong>{dialog.row.assetCode}</strong> · {dialog.row.assetName}
              {dialog.kind === "complete" ? <> · {dialog.row.maintenanceType} ({dialog.row.scheduledDate})</> : null}
            </p>
            {dialog.kind === "complete" ? (
              <>
                <Field label={t("completedDate")} required error={cErrors.completedDate ? t(cErrors.completedDate) : undefined}>
                  <Input type="date" value={completedDate} max={todayIST()} onChange={(e) => setCompletedDate(e.target.value)} />
                </Field>
                <Field label={t("cost")} hint={t("costHint")} error={cErrors.cost ? t(cErrors.cost) : undefined}>
                  <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="4500.00" />
                </Field>
                <Field label={t("notes")}>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                </Field>
                <p style={{ margin: 0, fontSize: 13 }}>{t("completeNote")}</p>
              </>
            ) : (
              <>
                <Field label={t("meterType")} required>
                  <Select value={meterType} onChange={(e) => setMeterType(e.target.value as MeterType)}>
                    {METER_TYPES.map((m) => <option key={m} value={m}>{t(`meter_${m}`)}</option>)}
                  </Select>
                </Field>
                <Field label={t("readingValue")} required error={mErrors.value ? t(mErrors.value) : undefined}>
                  <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="48210" />
                </Field>
                <Field label={t("unit")} required error={mErrors.unit ? t(mErrors.unit) : undefined}>
                  <Input value={unit} maxLength={16} onChange={(e) => setUnit(e.target.value)} />
                </Field>
                <Field label={t("readingDate")} required error={mErrors.readingDate ? t(mErrors.readingDate) : undefined}>
                  <Input type="date" value={readingDate} max={todayIST()} onChange={(e) => setReadingDate(e.target.value)} />
                </Field>
                <Field label={t("notes")}>
                  <Textarea value={mNotes} onChange={(e) => setMNotes(e.target.value)} rows={2} />
                </Field>
              </>
            )}
            {serverError ? <p role="alert" style={{ margin: 0, color: "var(--bad, #b42318)" }}>{serverError}</p> : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setDialog(null)}>{t("cancel")}</Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? t("submitting") : dialog.kind === "complete" ? t("completeConfirm") : t("meterConfirm")}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
