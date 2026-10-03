"use client";
import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Card, ConfirmDialog, DataTable, StatusPill } from "@/app/_components/ds";
import type { AdminInvoiceDetail } from "@/app/_data/loaders";
import { formatIndianDate, formatIndianDateTime, formatMoney } from "@/lib/formatters";
import {
  OFFLINE_MODES, isSettleableStatus, mapBillingSettings, mapOfflinePayments, mapReminderStatus, opsErrorKey, parseReminderDays, todayInIndia, validateOfflineForm,
  type BillingSettingsView, type OfflineFormErrors, type OfflineMode, type OfflinePaymentView, type ReminderView,
} from "@/lib/admin/invoiceOps";

export type InvoiceOpsData = {
  /** null = the read failed (shown as an error with retry, never as "no payments"). */
  payments: OfflinePaymentView[] | null;
  reminders: ReminderView | null;
  /** Billing settings (platform operators only); null = not shown or could not be read. */
  settings: BillingSettingsView | null;
  canOperate: boolean;
};

type Row = OfflinePaymentView & Record<string, unknown>;
const field: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13.5, fontFamily: "inherit" };

async function api(path: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  try {
    const res = await fetch(`/api/proxy/v1/billing${path}`, {
      method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: {} };
  }
}

/**
 * Offline payment (maker-checker) and reminder controls for one invoice. Money is integer paise end to
 * end; the amount is not editable (it must equal the outstanding balance). Failed reads, empty lists and
 * refused actions are different states with plain-language messages (en/hi).
 */
export function InvoiceOpsPanel({ invoice, initial }: { invoice: AdminInvoiceDetail; initial: InvoiceOpsData }) {
  const t = useTranslations("adminInvoiceOps");
  const [payments, setPayments] = useState(initial.payments);
  const [reminders, setReminders] = useState(initial.reminders);
  const [settings, setSettings] = useState(initial.settings);
  const makerOff = settings?.offlineMakerChecker === false;
  const [notice, setNotice] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [decision, setDecision] = useState<{ row: OfflinePaymentView; approve: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderMsg, setReminderMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const settleable = isSettleableStatus(invoice.status);
  const outstanding = invoice.outstandingMinor;
  const pending = payments?.find((p) => p.status === "pending") ?? null;
  // The invoice date is the India calendar date of issue (matches the server rule), not the UTC slice.
  const invoiceDate = invoice.issuedAt ? todayInIndia(new Date(invoice.issuedAt)) : "1970-01-01";

  const [form, setForm] = useState<{ mode: OfflineMode; reference: string; paidOn: string; reason: string }>({ mode: "neft", reference: "", paidOn: todayInIndia(), reason: "" });
  const [errors, setErrors] = useState<OfflineFormErrors>({});
  const errorText = (e: OfflineFormErrors, k: keyof OfflineFormErrors): string | undefined => {
    const code = e[k];
    if (!code) return undefined;
    if (code === "reference") return t(`ref_${form.mode}`);
    return t(code);
  };

  const reload = useCallback(async () => {
    const [p, r] = await Promise.all([api(`/invoices/${invoice.id}/offline-payments`, "GET"), api(`/invoices/${invoice.id}/reminders`, "GET")]);
    setPayments(p.ok ? mapOfflinePayments(p.json) : null);
    setReminders(r.ok ? mapReminderStatus(r.json) : null);
    if (initial.canOperate) {
      const st = await api("/settings", "GET");
      if (st.ok) setSettings(mapBillingSettings(st.json));
    }
  }, [invoice.id, initial.canOperate]);

  // A 202 means "queued": poll briefly so the screen shows the result instead of stale state.
  const settle = useCallback(async (until: (rows: OfflinePaymentView[] | null) => boolean) => {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 700));
      const p = await api(`/invoices/${invoice.id}/offline-payments`, "GET");
      const rows = p.ok ? mapOfflinePayments(p.json) : null;
      if (rows) setPayments(rows);
      if (until(rows)) return;
    }
  }, [invoice.id]);

  async function submitRecord() {
    const e = validateOfflineForm(form, todayInIndia(), invoiceDate);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    setDialogError(undefined);
    const res = await api(`/invoices/${invoice.id}/offline-payments`, "POST", {
      mode: form.mode, reference: form.reference.trim(), paidOn: form.paidOn, amountMinor: outstanding, reason: form.reason.trim(),
    });
    setBusy(false);
    if (!res.ok) { setDialogError(t(opsErrorKey(res.status, res.json.code))); return; }
    setRecordOpen(false);
    setForm({ mode: "neft", reference: "", paidOn: todayInIndia(), reason: "" });
    const before = payments?.length ?? 0;
    setNotice(makerOff ? t("submittedOff") : t("submitted"));
    // Two-person approval OFF applies the payment at once: wait for the new (approved) row instead of a pending one.
    await settle((rows) => (makerOff ? (rows?.length ?? 0) > before : !!rows?.some((r) => r.status === "pending")));
  }

  async function submitDecision(reason: string | undefined) {
    if (!decision) return;
    setBusy(true);
    setDialogError(undefined);
    const res = await api(`/invoices/${invoice.id}/offline-payments/${decision.row.id}/decision`, "POST", { approve: decision.approve, ...(reason ? { reason } : {}) });
    setBusy(false);
    if (!res.ok) { setDialogError(t(opsErrorKey(res.status, res.json.code))); return; }
    const approved = decision.approve;
    setDecision(null);
    setNotice(approved ? t("approvedNotice") : t("rejectedNotice"));
    await settle((rows) => !rows?.some((r) => r.status === "pending"));
  }

  async function sendReminder() {
    setReminderBusy(true);
    setReminderMsg(null);
    const res = await api(`/invoices/${invoice.id}/reminders`, "POST");
    setReminderBusy(false);
    if (!res.ok) { setReminderMsg({ kind: "err", text: t(opsErrorKey(res.status, res.json.code)) }); return; }
    setReminderMsg({ kind: "ok", text: t("reminderQueued", { count: typeof res.json.recipientCount === "number" ? res.json.recipientCount : 0 }) });
    await new Promise((r) => setTimeout(r, 700));
    const r = await api(`/invoices/${invoice.id}/reminders`, "GET");
    if (r.ok) setReminders(mapReminderStatus(r.json));
  }

  const rows = useMemo(() => (payments ?? []) as Row[], [payments]);
  const canRecord = initial.canOperate && settleable && !pending;

  return (
    <>
      {makerOff && (
        <div role="note" data-testid="maker-off-notice" style={{ margin: "0 0 12px", padding: "10px 14px", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 13 }}>
          {t("makerOffNotice")}
        </div>
      )}
      {notice && <div role="status" style={{ margin: "0 0 12px", fontSize: 13, color: "var(--mut)" }}>{notice}</div>}
      <Card title={t("offlineTitle")}>
        {payments === null ? (
          <div role="alert" style={{ padding: 12, fontSize: 13, color: "#b42318" }}>
            {t("loadFailed")} <Button type="button" variant="ghost" size="sm" onClick={() => void reload()}>{t("retry")}</Button>
          </div>
        ) : (
          <>
            {pending && (
              <div data-testid="pending-card" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14, margin: "0 0 14px", background: "var(--line2)" }}>
                <strong>{t("pendingTitle")}</strong>
                <p style={{ margin: "6px 0", fontSize: 13 }}>
                  {t("pendingSummary", { mode: t(`mode_${pending.mode}`), reference: pending.reference, amount: formatMoney(pending.amountMinor), paidOn: formatIndianDate(pending.paidOn) })}
                </p>
                <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--mut)" }}>
                  {pending.requestedByMe ? t("requestedByYou") : t("requestedByOther")} · {t("reasonLabel")}: {pending.reason}
                </p>
                {pending.canDecide ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button type="button" size="sm" onClick={() => { setDialogError(undefined); setDecision({ row: pending, approve: true }); }}>{t("approve")}</Button>
                    <Button type="button" variant="danger" size="sm" onClick={() => { setDialogError(undefined); setDecision({ row: pending, approve: false }); }}>{t("reject")}</Button>
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: 12.5 }}>{pending.requestedByMe ? t("waitingForOther") : t("noDecisionRights")}</p>
                )}
              </div>
            )}
            <DataTable<Row>
              columns={[
                { key: "mode", label: t("colMode"), render: (r) => t(`mode_${r.mode}`) },
                { key: "reference", label: t("colReference") },
                { key: "paidOn", label: t("colPaidOn"), render: (r) => formatIndianDate(r.paidOn) },
                { key: "amountMinor", label: t("colAmount"), align: "right", cellType: "amount" },
                { key: "status", label: t("colStatus"), render: (r) => <StatusPill status={String(r.status)} /> },
                { key: "decisionReason", label: t("colDecision"), render: (r) => (r.autoApproved ? t("autoApproved") : r.decisionReason ?? "—") },
              ]}
              rows={rows} pageSize={10} emptyIcon="🏦" emptyTitle={t("emptyTitle")} emptyMessage={t("emptyMessage")}
            />
            <div style={{ marginTop: 12 }}>
              {canRecord ? (
                <Button type="button" onClick={() => { setErrors({}); setDialogError(undefined); setRecordOpen(true); }}>{t("record")}</Button>
              ) : (
                <span style={{ fontSize: 12.5, color: "var(--mut)" }}>
                  {!initial.canOperate ? t("viewOnly") : !settleable ? t("notSettleable") : t("pendingBlocks")}
                </span>
              )}
            </div>
          </>
        )}
      </Card>

      <Card title={t("reminderTitle")}>
        {reminders === null ? (
          <div role="alert" style={{ padding: 12, fontSize: 13, color: "#b42318" }}>
            {t("loadFailed")} <Button type="button" variant="ghost" size="sm" onClick={() => void reload()}>{t("retry")}</Button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13 }}>
              {reminders.lastSentAt ? t("lastSent", { time: formatIndianDateTime(reminders.lastSentAt) }) : t("neverSent")}
            </p>
            {reminders.nextAllowedAt && <p style={{ margin: 0, fontSize: 12.5, color: "var(--mut)" }}>{t("nextAllowed", { time: formatIndianDateTime(reminders.nextAllowedAt) })}</p>}
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--mut)" }}>{t("reminderWho")}</p>
            {initial.canOperate && settleable ? (
              <div>
                <Button type="button" variant="ghost" onClick={() => void sendReminder()} loading={reminderBusy} disabled={reminderBusy || !!reminders.nextAllowedAt}>
                  {reminderBusy ? t("sending") : t("sendReminder")}
                </Button>
              </div>
            ) : (
              <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{initial.canOperate ? t("notSettleable") : t("viewOnly")}</span>
            )}
            {reminderMsg && <span role={reminderMsg.kind === "err" ? "alert" : "status"} style={{ fontSize: 12.5, color: reminderMsg.kind === "err" ? "#b42318" : "#027a48" }}>{reminderMsg.text}</span>}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={recordOpen}
        title={t("recordTitle")}
        description={makerOff ? t("recordDescriptionOff") : t("recordDescription")}
        confirmLabel={makerOff ? t("submitRequestOff") : t("submitRequest")}
        busy={busy}
        errorMessage={dialogError}
        onConfirm={() => void submitRecord()}
        onCancel={() => { if (!busy) setRecordOpen(false); }}
      >
        <div style={{ display: "grid", gap: 10, margin: "10px 0" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>{t("fieldMode")}
            <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as OfflineMode })} style={field}>
              {OFFLINE_MODES.map((m) => <option key={m} value={m}>{t(`mode_${m}`)}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>{t("fieldReference")}
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} style={field} autoComplete="off" maxLength={60} />
            {errors.reference && <span role="alert" style={{ color: "#b42318" }}>{errorText(errors, "reference")}</span>}
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>{t("fieldPaidOn")}
            <input type="date" value={form.paidOn} max={todayInIndia()} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} style={field} />
            {errors.paidOn && <span role="alert" style={{ color: "#b42318" }}>{errorText(errors, "paidOn")}</span>}
          </label>
          <div style={{ fontSize: 12.5 }}>
            <div style={{ marginBottom: 4 }}>{t("fieldAmount")}</div>
            <strong data-testid="record-amount">{formatMoney(outstanding)}</strong>
            <div style={{ color: "var(--mut)" }}>{t("amountFixed")}</div>
          </div>
          <label style={{ display: "grid", gap: 4, fontSize: 12.5 }}>{t("fieldReason")}
            <textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} style={field} maxLength={500} />
            {errors.reason && <span role="alert" style={{ color: "#b42318" }}>{errorText(errors, "reason")}</span>}
          </label>
        </div>
      </ConfirmDialog>

      {initial.canOperate && settings && <BillingSettingsCard settings={settings} onChanged={reload} />}

      <ConfirmDialog
        open={decision !== null}
        danger={decision?.approve === false}
        requireReason={decision?.approve === false}
        optionalReason={decision?.approve === true}
        minReasonLength={3}
        maxReasonLength={500}
        title={decision?.approve ? t("approveTitle") : t("rejectTitle")}
        description={decision ? (decision.approve ? t("approveDescription", { amount: formatMoney(decision.row.amountMinor) }) : t("rejectDescription")) : undefined}
        confirmLabel={decision?.approve ? t("approve") : t("reject")}
        busy={busy}
        errorMessage={dialogError}
        onConfirm={(reason) => void submitDecision(reason)}
        onCancel={() => { if (!busy) setDecision(null); }}
      />
    </>
  );
}

/** Two-person approval switch (OFF needs a second approver) and the scheduled-reminder days. Uses the settings API. */
function BillingSettingsCard({ settings, onChanged }: { settings: BillingSettingsView; onChanged: () => Promise<void> }) {
  const t = useTranslations("adminInvoiceOps");
  const [dialog, setDialog] = useState<"off" | "on" | { decide: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [msg, setMsg] = useState<string | null>(null);
  const [days, setDays] = useState(settings.reminderOverdueDays === null ? "" : String(settings.reminderOverdueDays));
  const [daysMsg, setDaysMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const pending = settings.pendingMakerCheckerRequest;

  async function refreshSoon() {
    await new Promise((r) => setTimeout(r, 700));
    await onChanged();
  }
  async function confirm(reason: string | undefined) {
    if (dialog === null) return;
    setBusy(true);
    setError(undefined);
    let res;
    if (dialog === "off" || dialog === "on") {
      res = await api("/settings/maker-checker", "POST", { enabled: dialog === "on", reason });
    } else if (pending) {
      res = await api(`/settings/maker-checker/requests/${pending.id}/decision`, "POST", { approve: dialog.decide, ...(reason ? { reason } : {}) });
    } else {
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!res.ok) { setError(t(opsErrorKey(res.status, res.json.code))); return; }
    setMsg(dialog === "off" ? t("makerRequested") : dialog === "on" ? t("makerSwitchedOn") : null);
    setDialog(null);
    await refreshSoon();
  }
  async function saveDays() {
    const parsed = parseReminderDays(days);
    if (parsed === undefined) { setDaysMsg({ kind: "err", text: t("daysInvalid") }); return; }
    const res = await api("/settings/reminder-days", "PUT", { days: parsed });
    if (!res.ok) { setDaysMsg({ kind: "err", text: t(opsErrorKey(res.status, res.json.code)) }); return; }
    setDaysMsg({ kind: "ok", text: t("daysSaved") });
    await refreshSoon();
  }

  const deciding = typeof dialog === "object" && dialog !== null;
  return (
    <Card title={t("settingsTitle")}>
      <div style={{ display: "grid", gap: 14 }} data-testid="billing-settings">
        <div>
          <strong style={{ fontSize: 13 }}>{t("makerCheckerLabel")}</strong>
          <p style={{ margin: "4px 0 8px", fontSize: 13 }}>{settings.offlineMakerChecker ? t("makerOnText") : t("makerOffText")}</p>
          {pending && (
            <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, margin: "0 0 8px", background: "var(--line2)" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("makerPendingTitle")}</div>
              <div style={{ fontSize: 12.5, color: "var(--mut)", margin: "4px 0" }}>{pending.requestedByMe ? t("requestedByYou") : t("requestedByOther")} · {t("reasonLabel")}: {pending.reason}</div>
              {pending.requestedByMe ? <div style={{ fontSize: 12.5 }}>{t("waitingForOther")}</div> : (
                <div style={{ display: "flex", gap: 8 }}>
                  <Button type="button" size="sm" onClick={() => { setError(undefined); setDialog({ decide: true }); }}>{t("approve")}</Button>
                  <Button type="button" variant="danger" size="sm" onClick={() => { setError(undefined); setDialog({ decide: false }); }}>{t("reject")}</Button>
                </div>
              )}
            </div>
          )}
          {!pending && (settings.offlineMakerChecker
            ? <Button type="button" variant="ghost" size="sm" onClick={() => { setError(undefined); setDialog("off"); }}>{t("makerRequestOff")}</Button>
            : <Button type="button" variant="ghost" size="sm" onClick={() => { setError(undefined); setDialog("on"); }}>{t("makerSwitchOn")}</Button>)}
          {msg && <div role="status" style={{ fontSize: 12.5, color: "#027a48", marginTop: 6 }}>{msg}</div>}
        </div>
        <div>
          <label htmlFor="reminder-days" style={{ fontSize: 13, fontWeight: 600 }}>{t("reminderDaysLabel")}</label>
          <div style={{ display: "flex", gap: 8, margin: "6px 0" }}>
            <input id="reminder-days" inputMode="numeric" value={days} onChange={(e) => { setDays(e.target.value); setDaysMsg(null); }} style={{ ...field, width: 120 }} />
            <Button type="button" size="sm" onClick={() => void saveDays()}>{t("saveDays")}</Button>
          </div>
          <div style={{ fontSize: 12, color: "var(--mut)" }}>{t("reminderDaysHint")}</div>
          {daysMsg && <div role={daysMsg.kind === "err" ? "alert" : "status"} style={{ fontSize: 12.5, marginTop: 4, color: daysMsg.kind === "err" ? "#b42318" : "#027a48" }}>{daysMsg.text}</div>}
        </div>
      </div>
      <ConfirmDialog
        open={dialog !== null}
        danger={dialog === "off" || (deciding && (dialog as { decide: boolean }).decide === false)}
        requireReason={dialog === "off" || dialog === "on" || (deciding && (dialog as { decide: boolean }).decide === false)}
        optionalReason={deciding && (dialog as { decide: boolean }).decide === true}
        minReasonLength={3}
        maxReasonLength={500}
        title={dialog === "off" ? t("makerOffDialogTitle") : dialog === "on" ? t("makerOnDialogTitle") : (deciding && (dialog as { decide: boolean }).decide ? t("approve") : t("reject"))}
        description={dialog === "off" ? t("makerOffDialogBody") : dialog === "on" ? t("makerOnDialogBody") : undefined}
        confirmLabel={dialog === "off" ? t("makerRequestOff") : dialog === "on" ? t("makerSwitchOn") : (deciding && (dialog as { decide: boolean }).decide ? t("approve") : t("reject"))}
        busy={busy}
        errorMessage={error}
        onConfirm={(reason) => void confirm(reason)}
        onCancel={() => { if (!busy) setDialog(null); }}
      />
    </Card>
  );
}
