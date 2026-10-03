"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, StatusPill } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";
import { useSessionIdentity } from "@/lib/auth/useSessionIdentity";
import {
  activeOffer, buildOfferPayload, offerActions, EMPTY_OFFER_FORM,
  type OfferForm, type OfferFormError, type OfferView,
} from "./offerWorkflow";

const inputClass = "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500";
const labelClass = "block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1";
/** Writes are queued (202); re-read once more shortly after the first re-read. */
const REREAD_MS = 1200;

type Props = {
  applicationId: string;
  applicantName: string;
  onClose: () => void;
  /** Called after any change that may have moved the application (e.g. a release moves it to "offered"). */
  onChanged: () => void;
};

/**
 * GAP-RECRUITMENT-DETAIL-05: offers go through the approval workflow
 * (draft -> submit -> approve by each chain stage, maker != checker -> release), not the single-field
 * PATCH that skipped it. Pay-matrix level + cell are optional (Govt / PSU posts).
 */
export function OfferWorkflowDialog({ applicationId, applicantName, onClose, onChanged }: Props) {
  const t = useTranslations("recruitmentFinish");
  const formError = useFormError("offer");
  const who = useSessionIdentity();
  const uid = useId();
  const [offers, setOffers] = useState<OfferView[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState<OfferForm>(EMPTY_OFFER_FORM);
  const [formErr, setFormErr] = useState<OfferFormError | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [comments, setComments] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/proxy/v1/hrms/applications/${applicationId}/offers`);
      if (!res.ok) { if (mounted.current) setLoadFailed(true); return; }
      const j = (await res.json()) as { data?: OfferView[] };
      if (mounted.current) { setOffers(j.data ?? []); setLoadFailed(false); }
    } catch {
      if (mounted.current) setLoadFailed(true);
    }
  }, [applicationId]);

  useEffect(() => { void load(); }, [load]);

  const reloadAfterWrite = useCallback(() => {
    void load();
    setTimeout(() => { if (mounted.current) { void load(); onChanged(); } }, REREAD_MS);
  }, [load, onChanged]);

  async function post(path: string, body: unknown, okText: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/proxy${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const env = (await res.clone().json().catch(() => null)) as { code?: string } | null;
        const text = env?.code === "SOD_VIOLATION" ? t("offerSod")
          : env?.code === "NOT_SHORTLISTED" ? t("offerNotShortlisted")
          : env?.code === "WRONG_STATE" ? t("offerWrongState")
          : (await formError.fromResponse(res, "save")).message;
        setMessage({ kind: "error", text });
        return false;
      }
      setMessage({ kind: "ok", text: okText });
      reloadAfterWrite();
      return true;
    } catch {
      setMessage({ kind: "error", text: formError.fromException("save").message });
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function createDraft(e: React.FormEvent) {
    e.preventDefault();
    const built = buildOfferPayload(form);
    if (!built.ok) { setFormErr(built.error); return; }
    setFormErr(null);
    if (await post(`/v1/hrms/applications/${applicationId}/offers`, built.payload, t("offerDraftCreated"))) setForm(EMPTY_OFFER_FORM);
  }

  async function lookupMatrixBasic() {
    const level = Number(form.payLevel);
    const cell = Number(form.payCell);
    if (!Number.isInteger(level) || !Number.isInteger(cell) || level < 1 || level > 18 || cell < 1 || cell > 40) { setFormErr("payLevelCell"); return; }
    try {
      const res = await fetch(`/api/proxy/v1/hrms/pay-matrix/lookup?level=${level}&cell=${cell}`);
      if (!res.ok) { setMessage({ kind: "error", text: t("offerMatrixFailed") }); return; }
      const j = (await res.json()) as { basicMinor?: string };
      if (!j.basicMinor || !/^\d+$/.test(j.basicMinor)) { setMessage({ kind: "error", text: t("offerMatrixFailed") }); return; }
      const minor = BigInt(j.basicMinor);
      const rupees = `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`;
      setForm((f) => ({ ...f, basic: rupees }));
      setFormErr(null);
    } catch {
      setMessage({ kind: "error", text: t("offerMatrixFailed") });
    }
  }

  const active = offers ? activeOffer(offers) : null;
  const acts = active ? offerActions(active, { userId: who.userId, roles: who.roles }) : null;
  const set = (k: keyof OfferForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const errText = formErr === "basic" ? t("offerBasicRequired") : formErr === "amount" ? t("offerAmountInvalid") : formErr === "payLevelCell" ? t("offerPayLevelCellInvalid") : null;

  return (
    <Modal open onClose={onClose} title={t("offerTitle", { name: applicantName })} size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("offerIntro")}</p>

        {offers === null && !loadFailed && <p role="status" className="text-sm text-slate-500">{t("offerLoading")}</p>}
        {loadFailed && (
          <p role="alert" className="text-sm text-red-600">
            {t("offerLoadFailed")}{" "}
            <button type="button" className="underline" onClick={() => { setLoadFailed(false); void load(); }}>{t("retry")}</button>
          </p>
        )}

        {offers && offers.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label={t("offerHistory")}>
            {offers.map((o) => (
              <li key={o.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{o.offerNo ?? o.id.slice(0, 8)} · v{o.offerVersion}</span>
                  <StatusPill status={o.status} />
                </div>
                <p className="mt-1 text-slate-600 dark:text-slate-300">
                  {t("offerGross", { amount: formatMoney(o.grossCtcMinor) })}
                  {o.payLevel ? ` · ${t("offerPayLevelCell", { level: o.payLevel, cell: o.payCell ?? "—" })}` : ""}
                  {o.grade ? ` · ${o.grade}` : ""}
                  {o.joiningDate ? ` · ${t("offerJoining", { date: formatIndianDate(o.joiningDate) })}` : ""}
                </p>
                {o.status === "pending_approval" && o.approvalChain[o.currentStage] && (
                  <p className="mt-1 text-amber-700 dark:text-amber-300">{t("offerAwaiting", { stage: o.approvalChain[o.currentStage]!.stage, role: o.approvalChain[o.currentStage]!.role })}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {active && acts && (
          <div className="flex flex-col gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
            {acts.approveBlockedReason === "creator" && <p className="text-xs text-slate-600 dark:text-slate-300">{t("offerYouCreatedThis")}</p>}
            {acts.approveBlockedReason === "role" && acts.awaitingRole && <p className="text-xs text-slate-600 dark:text-slate-300">{t("offerNeedsRole", { role: acts.awaitingRole })}</p>}
            {(acts.canApprove || acts.canReturn) && (
              <div>
                <label htmlFor={`${uid}-comments`} className={labelClass}>{t("offerComments")}</label>
                <input id={`${uid}-comments`} className={inputClass} maxLength={2000} value={comments} onChange={(e) => setComments(e.target.value)} />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {acts.canSubmit && <Button disabled={busy} onClick={() => void post(`/v1/hrms/offers/${active.id}/submit`, {}, t("offerSubmitted"))}>{t("offerSubmit")}</Button>}
              {acts.canApprove && <Button disabled={busy} onClick={() => void post(`/v1/hrms/offers/${active.id}/approve`, comments.trim() ? { comments: comments.trim() } : {}, t("offerApproved"))}>{t("offerApprove")}</Button>}
              {acts.canReturn && <Button variant="secondary" disabled={busy || comments.trim() === ""} onClick={() => void post(`/v1/hrms/offers/${active.id}/return`, { comments: comments.trim() }, t("offerReturned"))}>{t("offerReturn")}</Button>}
              {acts.canRelease && <Button disabled={busy} onClick={() => void post(`/v1/hrms/offers/${active.id}/release`, {}, t("offerReleased"))}>{t("offerRelease")}</Button>}
            </div>
            {acts.canReturn && comments.trim() === "" && <p className="text-[11px] text-slate-500">{t("offerReturnNeedsComment")}</p>}
          </div>
        )}

        {offers && !active && (
          <form onSubmit={createDraft} className="grid grid-cols-2 gap-3" aria-label={t("offerCreate")}>
            <div className="col-span-2 grid grid-cols-3 gap-3">
              <div>
                <label htmlFor={`${uid}-level`} className={labelClass}>{t("offerPayLevel")}</label>
                <input id={`${uid}-level`} type="number" min={1} max={18} inputMode="numeric" className={inputClass} value={form.payLevel} onChange={set("payLevel")} />
              </div>
              <div>
                <label htmlFor={`${uid}-cell`} className={labelClass}>{t("offerPayCell")}</label>
                <input id={`${uid}-cell`} type="number" min={1} max={40} inputMode="numeric" className={inputClass} value={form.payCell} onChange={set("payCell")} />
              </div>
              <div className="flex items-end">
                <Button type="button" variant="secondary" onClick={() => void lookupMatrixBasic()}>{t("offerUseMatrix")}</Button>
              </div>
            </div>
            <div className="col-span-2">
              <label htmlFor={`${uid}-basic`} className={labelClass}>{t("offerBasic")}</label>
              <input id={`${uid}-basic`} type="text" inputMode="decimal" className={inputClass} placeholder={t("offerAmountPlaceholder")} value={form.basic} onChange={set("basic")} required aria-invalid={formErr === "basic"} />
            </div>
            <div>
              <label htmlFor={`${uid}-bonus`} className={labelClass}>{t("offerJoiningBonus")}</label>
              <input id={`${uid}-bonus`} type="text" inputMode="decimal" className={inputClass} value={form.joiningBonus} onChange={set("joiningBonus")} />
            </div>
            <div>
              <label htmlFor={`${uid}-reloc`} className={labelClass}>{t("offerRelocation")}</label>
              <input id={`${uid}-reloc`} type="text" inputMode="decimal" className={inputClass} value={form.relocation} onChange={set("relocation")} />
            </div>
            <div>
              <label htmlFor={`${uid}-var`} className={labelClass}>{t("offerVariable")}</label>
              <input id={`${uid}-var`} type="text" inputMode="decimal" className={inputClass} value={form.variablePay} onChange={set("variablePay")} />
            </div>
            <div>
              <label htmlFor={`${uid}-grade`} className={labelClass}>{t("offerGrade")}</label>
              <input id={`${uid}-grade`} type="text" maxLength={48} className={inputClass} value={form.grade} onChange={set("grade")} />
            </div>
            <div className="col-span-2">
              <label htmlFor={`${uid}-joining`} className={labelClass}>{t("offerJoiningDate")}</label>
              <input id={`${uid}-joining`} type="date" className={inputClass} value={form.joiningDate} onChange={set("joiningDate")} />
            </div>
            {errText && <p role="alert" className="col-span-2 text-xs text-red-600">{errText}</p>}
            <div className="col-span-2 flex justify-end">
              <Button type="submit" disabled={busy}>{busy ? t("saving") : t("offerCreate")}</Button>
            </div>
          </form>
        )}

        {message && <p role={message.kind === "error" ? "alert" : "status"} className={`text-xs ${message.kind === "error" ? "text-red-600" : "text-emerald-700"}`}>{message.text}</p>}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>{t("close")}</Button>
        </div>
      </div>
    </Modal>
  );
}
