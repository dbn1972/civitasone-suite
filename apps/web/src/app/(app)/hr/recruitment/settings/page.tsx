"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";
import { buildSettingsBody, toForm, type Settings, type SettingsError, type SettingsForm } from "./settingsForm";

const inputClass = "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200";
const labelClass = "block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1";

/**
 * Per-office recruitment settings: the public identity shown on every careers page, the offer-approval policy and the
 * applicant-data purpose note. Changing them needs an HR administrator (the service enforces it and audits the change).
 */
export default function RecruitmentSettingsPage() {
  const t = useTranslations("recruitmentFinish");
  const formError = useFormError("recruitment settings");
  const uid = useId();
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<SettingsError | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/v1/hrms/recruitment-settings");
      if (!res.ok) { setLoadFailed(true); return; }
      const j = (await res.json()) as { data?: Settings };
      if (!j.data) { setLoadFailed(true); return; }
      setForm(toForm(j.data));
      setLoadFailed(false);
    } catch { setLoadFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const built = buildSettingsBody(form);
    if (!built.ok) { setError(built.error); return; }
    setError(null);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/proxy/v1/hrms/recruitment-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(built.body) });
      if (!res.ok) {
        const env = (await res.clone().json().catch(() => null)) as { code?: string } | null;
        setMessage({ kind: "error", text: env?.code === "FORBIDDEN" ? t("setForbidden") : (await formError.fromResponse(res, "save")).message });
        return;
      }
      setMessage({ kind: "ok", text: t("setSaved") });
    } catch {
      setMessage({ kind: "error", text: formError.fromException("save").message });
    } finally { setBusy(false); }
  }

  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const err = (k: SettingsError) => (error === k ? t(`setErr_${k}`) : null);

  return (
    <div className="page-main" aria-labelledby="set-heading">
      <Link href="/hr/recruitment" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">{t("setBack")}</Link>
      <h1 id="set-heading" className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">{t("setHeading")}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t("setIntro")}</p>

      {loadFailed ? (
        <p role="alert" className="text-sm text-red-600">{t("setLoadFailed")} <button type="button" className="underline" onClick={() => { setLoadFailed(false); void load(); }}>{t("retry")}</button></p>
      ) : form === null ? (
        <p role="status" className="text-sm text-slate-500">{t("setLoading")}</p>
      ) : (
        <form onSubmit={save} className="flex max-w-xl flex-col gap-4">
          <fieldset className="flex flex-col gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <legend className="px-1 text-sm font-semibold">{t("setIdentity")}</legend>
            <p className="text-xs text-slate-500">{t("setIdentityHelp")}</p>
            <div>
              <label htmlFor={`${uid}-org`} className={labelClass}>{t("setOrgName")}</label>
              <input id={`${uid}-org`} className={inputClass} maxLength={200} value={form.organisationName} onChange={(e) => set("organisationName", e.target.value)} aria-invalid={error === "organisationName"} />
              {err("organisationName") && <p role="alert" className="mt-1 text-xs text-red-600">{err("organisationName")}</p>}
            </div>
            <div>
              <label htmlFor={`${uid}-dept`} className={labelClass}>{t("setDeptName")}</label>
              <input id={`${uid}-dept`} className={inputClass} maxLength={200} value={form.departmentName} onChange={(e) => set("departmentName", e.target.value)} aria-invalid={error === "departmentName"} />
              {err("departmentName") && <p role="alert" className="mt-1 text-xs text-red-600">{err("departmentName")}</p>}
            </div>
            <div>
              <label htmlFor={`${uid}-emblem`} className={labelClass}>{t("setEmblem")}</label>
              <input id={`${uid}-emblem`} className={inputClass} value={form.emblemUrl} onChange={(e) => set("emblemUrl", e.target.value)} placeholder="https://" aria-invalid={error === "emblemUrl"} />
              {err("emblemUrl") && <p role="alert" className="mt-1 text-xs text-red-600">{err("emblemUrl")}</p>}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <legend className="px-1 text-sm font-semibold">{t("setOffers")}</legend>
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={form.offerWorkflowRequired} onChange={(e) => set("offerWorkflowRequired", e.target.checked)} className="mt-1" />
              <span>{t("setOfferWorkflow")}</span>
            </label>
            <p className="text-xs text-slate-500">{t("setOfferWorkflowHelp")}</p>
          </fieldset>

          <fieldset className="flex flex-col gap-2 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <legend className="px-1 text-sm font-semibold">{t("setPrivacy")}</legend>
            <label htmlFor={`${uid}-note`} className={labelClass}>{t("setPurposeNote")}</label>
            <textarea id={`${uid}-note`} className={inputClass} rows={4} maxLength={2000} value={form.applicantPurposeNote} onChange={(e) => set("applicantPurposeNote", e.target.value)} aria-invalid={error === "applicantPurposeNote"} />
            <p className="text-xs text-slate-500">{t("setPurposeNoteHelp")}</p>
            {err("applicantPurposeNote") && <p role="alert" className="text-xs text-red-600">{err("applicantPurposeNote")}</p>}
          </fieldset>

          {message && <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-red-600" : "text-emerald-700"}`}>{message.text}</p>}
          <div><Button type="submit" disabled={busy}>{busy ? t("saving") : t("setSave")}</Button></div>
        </form>
      )}
    </div>
  );
}
