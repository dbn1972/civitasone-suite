"use client";

/**
 * Re-appropriation-with-eOffice-approval -- the request-first raise flow (GAP-FINANCE-BUDGET-ALLOCATION-03).
 *
 * A budget re-appropriation is a zero-sum transfer between two budget heads (GFR Rule 10), so it is a
 * create-and-raise action: the request id is a CLIENT-generated uuid used as both the re-appropriation request
 * id and the eFile refId (kept for the life of the form so a retry after a half-failure is the same request):
 *   1) POST /v1/finance/reappropriations/{uuid}/submit-approval { fromBudgetId, toBudgetId, headId?, amountMinor,
 *      reason } -> a pending_approval request. amountMinor is paise as an exact decimal STRING.
 *   2) POST /v1/estab/files/from-module -> raises the eFile against that id (refType "finance_reappropriation");
 *      on approval the finance reappropriation eoffice-consumer applies the transfer.
 * The "from" (savings) and "to" budgets are chosen from the allocations on the page, never typed as UUIDs, and
 * the officers are picked by name (the signed-in user defaults as the initiator).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog, Field, Input, Select, Textarea, type EntityOption } from "@/app/_components/ds";
import { EmployeePicker } from "@/app/_components/EmployeePicker";
import { useSelfEmployee } from "@/app/_components/useSelfEmployee";
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";
import { validateReappropriation, type AllocationOption, type ReappropriationInput } from "@/lib/finance/reappropriation";

const EMPTY: ReappropriationInput = { fromBudgetId: "", toBudgetId: "", amount: "", reason: "" };

export function ReappropriateWithApproval({ allocations }: { allocations: AllocationOption[] }) {
  const t = useTranslations("financeReappropriate");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ReappropriationInput>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof ReappropriationInput | "initiatedBy" | "currentWith" | "note", string>>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [initiatedBy, setInitiatedBy] = useState<string | null>(null);
  const [initiated, setInitiated] = useState<EntityOption | null>(null);
  const [currentWith, setCurrentWith] = useState<string | null>(null);
  const [forwardedTo, setForwardedTo] = useState<EntityOption | null>(null);
  const [note, setNote] = useState("");
  // One request id per form session: a retry after a half-failure is the SAME request, never a duplicate.
  const requestId = useRef<string>(globalThis.crypto.randomUUID());
  // The first step is idempotent on that id; remember it succeeded so a retry only repeats the eFile step.
  const created = useRef(false);

  const self = useSelfEmployee(open);
  useEffect(() => {
    if (self) {
      setInitiatedBy((cur) => cur ?? self.id);
      setInitiated((cur) => cur ?? self);
    }
  }, [self]);

  const optionLabel = (id: string) => allocations.find((a) => a.id === id)?.label ?? "";
  const review = (e: React.FormEvent) => {
    e.preventDefault();
    const r = validateReappropriation(form, allocations);
    const next: typeof errors = {};
    if (!r.ok) for (const [k, v] of Object.entries(r.errors)) next[k as keyof ReappropriationInput] = t(`err.${v}`);
    if (!initiatedBy) next.initiatedBy = t("err.initiatorRequired");
    if (!currentWith) next.currentWith = t("err.forwardRequired");
    else if (currentWith === initiatedBy) next.currentWith = t("err.forwardSelf");
    if (note.trim().length < 3) next.note = t("err.noteShort");
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setDialogError(undefined);
    setConfirmOpen(true);
  };

  const submit = useCallback(async () => {
    const r = validateReappropriation(form, allocations);
    if (!r.ok || !initiatedBy || !currentWith) return;
    setBusy(true);
    setDialogError(undefined);
    try {
      const id = requestId.current;
      if (!created.current) {
        const sub = await browserFetch(`v1/finance/reappropriations/${id}/submit-approval`, {
          method: "POST",
          headers: { "x-idempotency-key": id },
          body: JSON.stringify(r.body),
        });
        if (!sub.ok) { setDialogError(await errorMessageFromResponse(sub, "save", "re-appropriation")); return; }
        created.current = true;
      }
      const raise = await browserFetch("v1/estab/files/from-module", {
        method: "POST",
        headers: { "x-idempotency-key": `${id}:file` },
        body: JSON.stringify({
          refType: "finance_reappropriation", refId: id,
          subject: `Budget re-appropriation — ${optionLabel(r.body.fromBudgetId)} to ${optionLabel(r.body.toBudgetId)}`,
          dept: "Finance", classification: "confidential", priority: "normal",
          initiatedBy, currentWith, approvalChain: "file_noting", initialNote: note.trim(),
          context: { fromBudgetId: r.body.fromBudgetId, toBudgetId: r.body.toBudgetId, amountMinor: r.body.amountMinor },
        }),
      });
      if (!raise.ok) { setDialogError(t("raiseFailed")); return; }
      const file = (await raise.json().catch(() => ({}))) as { fileNo?: string };
      setMessage(t("raised", { fileNo: file.fileNo ?? "", by: initiated?.label ?? "", to: forwardedTo?.label ?? "" }));
      setConfirmOpen(false);
      setOpen(false);
      setForm(EMPTY); setNote(""); setCurrentWith(null); setForwardedTo(null);
      requestId.current = globalThis.crypto.randomUUID();
      created.current = false;
    } catch {
      setDialogError(t("networkFailed"));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionLabel is derived from `allocations`, already listed.
  }, [form, allocations, initiatedBy, currentWith, note, initiated, forwardedTo, t]);

  const built = validateReappropriation(form, allocations);
  return (
    <>
      <Button onClick={() => { setOpen((v) => !v); setMessage(""); }} aria-expanded={open}>{open ? t("cancel") : t("open")}</Button>
      {message ? <p role="status" style={{ color: "#047857", fontSize: "0.8125rem" }}>{message}</p> : null}
      {open ? (
        <form onSubmit={review} noValidate className="card" style={{ marginTop: 14 }}>
          <div className="card-h"><h3>{t("heading")}</h3></div>
          <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <Field label={t("from")} {...(errors.fromBudgetId ? { error: errors.fromBudgetId } : {})}>
              <Select value={form.fromBudgetId} onChange={(e) => setForm({ ...form, fromBudgetId: e.target.value })}>
                <option value="">{t("choose")}</option>
                {allocations.map((a) => <option key={a.id} value={a.id}>{`${a.label} — ${t("available")} ${formatMoney(a.availableMinor)}`}</option>)}
              </Select>
            </Field>
            <Field label={t("to")} {...(errors.toBudgetId ? { error: errors.toBudgetId } : {})}>
              <Select value={form.toBudgetId} onChange={(e) => setForm({ ...form, toBudgetId: e.target.value })}>
                <option value="">{t("choose")}</option>
                {allocations.filter((a) => a.id !== form.fromBudgetId).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </Select>
            </Field>
            <Field label={t("amount")} {...(errors.amount ? { error: errors.amount } : {})}>
              <Input inputMode="decimal" autoComplete="off" value={form.amount} placeholder="e.g. 50000.00" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label={t("initiator")} {...(errors.initiatedBy ? { error: errors.initiatedBy } : {})}>
              <EmployeePicker
                key={self?.id ?? "none"}
                value={initiatedBy}
                onChange={(id, opt) => { setInitiatedBy(id); setInitiated(opt); }}
                {...(self ? { initialOption: self } : {})}
                placeholder={t("searchOfficer")}
              />
            </Field>
            <Field label={t("forwardTo")} {...(errors.currentWith ? { error: errors.currentWith } : {})}>
              <EmployeePicker value={currentWith} onChange={(id, opt) => { setCurrentWith(id); setForwardedTo(opt); }} placeholder={t("searchOfficer")} />
            </Field>
          </div>
          <div className="pad" style={{ paddingTop: 0, display: "grid", gap: 12 }}>
            <Field label={t("reason")} {...(errors.reason ? { error: errors.reason } : {})}>
              <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </Field>
            <Field label={t("note")} {...(errors.note ? { error: errors.note } : {})}>
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div><Button type="submit">{t("review")}</Button></div>
          </div>
        </form>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        title={t("confirmTitle")}
        description={built.ok ? t("confirmDescription", { amount: formatMoney(built.body.amountMinor), from: optionLabel(built.body.fromBudgetId), to: optionLabel(built.body.toBudgetId) }) : ""}
        confirmLabel={t("confirmLabel")}
        busy={busy}
        {...(dialogError ? { errorMessage: dialogError } : {})}
        onConfirm={() => { void submit(); }}
        onCancel={() => { if (!busy) { setConfirmOpen(false); setDialogError(undefined); } }}
      />
    </>
  );
}
