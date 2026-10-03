"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog, ErrorState, useConfirmAction, Button } from "../../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { toHumanError } from "@/lib/messages";
import { rupeesToMinorString } from "@/lib/money";
import { formatIndianDateTime } from "@/lib/formatters";

/**
 * GAP-RECRUITMENT-DETAIL-13: the vacancy notification (advertisement) and its corrigenda -- fee, fee exemption,
 * required documents, selection process, important dates, portal scope, plus corrigendum / extend deadline /
 * cancel. Every call goes to an existing hrms route (publication-routes.ts); the three notices need a reason and
 * are confirm-gated, the fee is sent as integer paise, and a published advertisement is read-only here (changes to
 * it must be recorded as a corrigendum so the original is preserved, R-RA-0068).
 */

type Advertisement = {
  id: string;
  status: string;
  applicationDeadline: string | null;
  /** bigint paise, as a string. */
  feesMinor: string | null;
  feeExemption: string | null;
  requiredDocuments: string[];
  selectionProcess: string | null;
  importantDates: Record<string, string>;
  portalScope: "public" | "internal" | "both";
};

type Corrigendum = { id: string; seq: number; action: string; changes: string; oldDeadline: string | null; newDeadline: string | null; createdAt: string };

type DateRow = { key: string; label: string; value: string };

const QUEUED_RELOAD_MS = 1200;
const MAX_DOCS = 50;

/** paise string -> "1234.50" rupees, exact (no float). */
export function paiseToRupeesInput(paise: string | null): string {
  if (!paise || !/^\d+$/.test(paise)) return "";
  const p = paise.padStart(3, "0");
  return `${p.slice(0, -2)}.${p.slice(-2)}`;
}

/** A datetime-local value ("YYYY-MM-DDTHH:mm[:ss]") interpreted as IST (+05:30), as an ISO instant, or null. */
export function istInputToIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)) return null;
  const d = new Date(`${v.length === 16 ? `${v}:00` : v}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function VacancyNotificationPanel({ jobOpeningId, published, onChanged }: { jobOpeningId: string; published: boolean; onChanged: () => void }) {
  const t = useTranslations("recruitmentAdvert");
  const formError = useFormError("vacancy");
  const [ad, setAd] = useState<Advertisement | null>(null);
  const [corrigenda, setCorrigenda] = useState<Corrigendum[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  const [fee, setFee] = useState("");
  const [feeExemption, setFeeExemption] = useState("");
  const [docs, setDocs] = useState("");
  const [selection, setSelection] = useState("");
  const [dates, setDates] = useState<DateRow[]>([]);
  const [scope, setScope] = useState<Advertisement["portalScope"]>("public");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  const [corrigendumKind, setCorrigendumKind] = useState<"corrigendum" | "extension" | "cancellation">("corrigendum");
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = useId();
  const nextRowKey = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const hydrate = useCallback((a: Advertisement) => {
    setFee(paiseToRupeesInput(a.feesMinor));
    setFeeExemption(a.feeExemption ?? "");
    setDocs(a.requiredDocuments.join("\n"));
    setSelection(a.selectionProcess ?? "");
    setScope(a.portalScope);
    setDates(Object.entries(a.importantDates).map(([label, value]) => ({ key: `d${nextRowKey.current++}`, label, value })));
  }, []);

  const load = useCallback(async (opts: { hydrateForm: boolean }) => {
    setLoadFailed(false);
    try {
      const [adRes, corrRes] = await Promise.all([
        fetch(`/api/proxy/v1/hrms/job-openings/${jobOpeningId}/advertisement`),
        fetch(`/api/proxy/v1/hrms/job-openings/${jobOpeningId}/corrigenda`),
      ]);
      if (!adRes.ok || !corrRes.ok) { if (mounted.current) setLoadFailed(true); return; }
      const adBody = (await adRes.json()) as Advertisement;
      const corrBody = (await corrRes.json()) as { data?: Corrigendum[] };
      if (!mounted.current) return;
      setAd(adBody);
      setCorrigenda(corrBody.data ?? []);
      if (opts.hydrateForm) hydrate(adBody);
    } catch {
      if (mounted.current) setLoadFailed(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [jobOpeningId, hydrate]);

  useEffect(() => { void load({ hydrateForm: true }); }, [load]);

  // Writes are queued (the route answers before the consumer has applied them): re-read now and once more shortly after.
  const reloadAfterWrite = useCallback((hydrateForm: boolean) => {
    void load({ hydrateForm });
    onChanged();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (mounted.current) { void load({ hydrateForm }); onChanged(); } }, QUEUED_RELOAD_MS);
  }, [load, onChanged]);

  const cancelled = ad?.status === "cancelled";
  const readOnly = published || cancelled;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    const body: Record<string, unknown> = {};
    const trimmedFee = fee.trim();
    if (trimmedFee === "") {
      // Clearing a previously set fee is explicit; an untouched empty field sends nothing.
      if (ad?.feesMinor != null) body.feesMinor = null;
    } else {
      const minor = rupeesToMinorString(trimmedFee, { allowZero: true });
      const n = minor === null ? Number.NaN : Number(minor);
      if (!Number.isSafeInteger(n)) { setSaveState("error"); setSaveMessage(t("feeInvalid")); return; }
      body.feesMinor = n;
    }
    body.feeExemption = feeExemption.trim();
    const docList = docs.split("\n").map((d) => d.trim()).filter(Boolean);
    if (docList.length > MAX_DOCS || docList.some((d) => d.length > 200)) { setSaveState("error"); setSaveMessage(t("docsInvalid")); return; }
    body.requiredDocuments = docList;
    body.selectionProcess = selection.trim();
    const dateMap: Record<string, string> = {};
    for (const r of dates) {
      const label = r.label.trim();
      const value = r.value.trim();
      if (!label && !value) continue;
      if (!label || !value || label.length > 64 || value.length > 64) { setSaveState("error"); setSaveMessage(t("datesInvalid")); return; }
      dateMap[label] = value;
    }
    body.importantDates = dateMap;
    body.portalScope = scope;
    setSaveState("saving");
    setSaveMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/hrms/job-openings/${jobOpeningId}/advertisement`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { setSaveState("error"); setSaveMessage((await formError.fromResponse(res, "save")).message); return; }
      setSaveState("saved");
      reloadAfterWrite(false);
    } catch {
      setSaveState("error");
      setSaveMessage(formError.fromException("save").message);
    }
  }

  const notice = useConfirmAction({
    onConfirm: async (reason) => {
      const text = (reason ?? "").trim();
      let path: string;
      let body: Record<string, unknown>;
      if (corrigendumKind === "corrigendum") { path = "corrigendum"; body = { changes: text }; }
      else if (corrigendumKind === "cancellation") { path = "cancel"; body = { reason: text }; }
      else {
        path = "extend";
        body = { newDeadline: istInputToIso(newDeadline), reason: text };
      }
      const res = await fetch(`/api/proxy/v1/hrms/job-openings/${jobOpeningId}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await formError.fromResponse(res, "save")).message);
      reloadAfterWrite(true);
    },
  });

  // Forward-only: the new deadline must be later than the current one (the service enforces this too).
  const currentDeadlineMs = ad?.applicationDeadline ? new Date(ad.applicationDeadline).getTime() : null;
  const newDeadlineIso = istInputToIso(newDeadline);
  const newDeadlineMs = newDeadlineIso ? new Date(newDeadlineIso).getTime() : Number.NaN;
  const extensionInvalid = corrigendumKind === "extension" && (Number.isNaN(newDeadlineMs) || newDeadlineMs <= Date.now() || (currentDeadlineMs !== null && newDeadlineMs <= currentDeadlineMs));

  const open = (kind: typeof corrigendumKind) => { setCorrigendumKind(kind); setNewDeadline(""); notice.trigger(); };

  if (loading) return <p className="text-sm text-slate-500 dark:text-slate-400 py-4">{t("loading")}</p>;
  if (loadFailed || !ad) {
    return <ErrorState error={toHumanError("load", { area: "advertisement" })} onRetry={() => { setLoading(true); void load({ hydrateForm: true }); }} />;
  }

  const inputCls = "w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60";
  const labelCls = "block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1";
  const confirmCfg = corrigendumKind === "corrigendum"
    ? { title: t("corrigendumTitle"), desc: t("corrigendumDescription"), label: t("corrigendumConfirm"), reasonLabel: t("changesLabel"), danger: false, max: 4000 }
    : corrigendumKind === "extension"
      ? { title: t("extendTitle"), desc: t("extendDescription"), label: t("extendConfirm"), reasonLabel: t("reasonLabel"), danger: false, max: 2000 }
      : { title: t("cancelTitle"), desc: t("cancelDescription"), label: t("cancelConfirm"), reasonLabel: t("reasonLabel"), danger: true, max: 2000 };

  return (
    <div className="flex flex-col gap-6">
      {cancelled && <p role="status" className="rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-2 text-sm text-red-700 dark:text-red-300">{t("cancelledNotice")}</p>}
      {published && !cancelled && <p role="status" className="rounded-lg bg-amber-50 dark:bg-amber-900/20 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">{t("publishedReadOnly")}</p>}

      <form onSubmit={save} className="grid gap-3" aria-label={t("advertisementHeading")}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("advertisementHeading")}</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}-fee`} className={labelCls}>{t("feeLabel")}</label>
            <input id={`${uid}-fee`} type="text" inputMode="decimal" className={inputCls} value={fee} disabled={readOnly} onChange={(e) => setFee(e.target.value)} placeholder={t("feePlaceholder")} />
          </div>
          <div>
            <label htmlFor={`${uid}-scope`} className={labelCls}>{t("scopeLabel")}</label>
            <select id={`${uid}-scope`} className={inputCls} value={scope} disabled={readOnly} onChange={(e) => setScope(e.target.value as Advertisement["portalScope"])}>
              <option value="public">{t("scope_public")}</option>
              <option value="internal">{t("scope_internal")}</option>
              <option value="both">{t("scope_both")}</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={`${uid}-exempt`} className={labelCls}>{t("feeExemptionLabel")}</label>
          <textarea id={`${uid}-exempt`} rows={2} maxLength={2000} className={inputCls} value={feeExemption} disabled={readOnly} onChange={(e) => setFeeExemption(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-docs`} className={labelCls}>{t("docsLabel")}</label>
          <textarea id={`${uid}-docs`} rows={3} className={inputCls} value={docs} disabled={readOnly} onChange={(e) => setDocs(e.target.value)} aria-describedby={`${uid}-docs-help`} />
          <p id={`${uid}-docs-help`} className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{t("docsHelp")}</p>
        </div>
        <div>
          <label htmlFor={`${uid}-selection`} className={labelCls}>{t("selectionLabel")}</label>
          <textarea id={`${uid}-selection`} rows={2} maxLength={4000} className={inputCls} value={selection} disabled={readOnly} onChange={(e) => setSelection(e.target.value)} />
        </div>
        <fieldset className="grid gap-2" disabled={readOnly}>
          <legend className={labelCls}>{t("datesLabel")}</legend>
          {dates.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input aria-label={t("dateName", { n: i + 1 })} className={inputCls} maxLength={64} value={r.label} onChange={(e) => setDates((d) => d.map((x) => x.key === r.key ? { ...x, label: e.target.value } : x))} placeholder={t("dateNamePlaceholder")} />
              <input aria-label={t("dateValue", { n: i + 1 })} className={inputCls} maxLength={64} value={r.value} onChange={(e) => setDates((d) => d.map((x) => x.key === r.key ? { ...x, value: e.target.value } : x))} placeholder={t("dateValuePlaceholder")} />
              <button type="button" onClick={() => setDates((d) => d.filter((x) => x.key !== r.key))} className="text-xs text-red-600 dark:text-red-400 underline" aria-label={t("removeDate", { n: i + 1 })}>{t("remove")}</button>
            </div>
          ))}
          <div><button type="button" onClick={() => setDates((d) => [...d, { key: `d${nextRowKey.current++}`, label: "", value: "" }])} className="text-xs text-indigo-600 dark:text-indigo-400 underline">{t("addDate")}</button></div>
        </fieldset>
        {saveState === "error" && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{saveMessage}</p>}
        {saveState === "saved" && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">{t("saved")}</p>}
        <div><Button type="submit" disabled={readOnly || saveState === "saving"}>{saveState === "saving" ? t("saving") : t("save")}</Button></div>
      </form>

      <section className="grid gap-3" aria-label={t("corrigendaHeading")}>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("corrigendaHeading")}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t("currentDeadline")}: {ad.applicationDeadline ? formatIndianDateTime(ad.applicationDeadline) : t("noDeadline")}
        </p>
        {!cancelled && (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => open("corrigendum")}>{t("recordCorrigendum")}</Button>
            <Button variant="ghost" onClick={() => open("extension")}>{t("extendDeadline")}</Button>
            <Button variant="danger" onClick={() => open("cancellation")}>{t("cancelVacancy")}</Button>
          </div>
        )}
        {corrigenda.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t("noCorrigenda")}</p>
        ) : (
          <ol className="grid gap-2">
            {corrigenda.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm">
                <p className="font-medium text-slate-800 dark:text-slate-100">#{c.seq} · {t(`action_${c.action}`)} · <span className="font-normal text-slate-500 dark:text-slate-400">{formatIndianDateTime(c.createdAt)}</span></p>
                <p className="text-slate-700 dark:text-slate-200">{c.changes}</p>
                {c.action === "extension" && c.newDeadline && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">{c.oldDeadline ? formatIndianDateTime(c.oldDeadline) : t("noDeadline")} → {formatIndianDateTime(c.newDeadline)}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <ConfirmDialog
        open={notice.open}
        title={confirmCfg.title}
        description={confirmCfg.desc}
        confirmLabel={confirmCfg.label}
        danger={confirmCfg.danger}
        requireReason
        maxReasonLength={confirmCfg.max}
        reasonLabel={confirmCfg.reasonLabel}
        confirmDisabled={extensionInvalid}
        busy={notice.busy}
        errorMessage={notice.error}
        onConfirm={notice.confirm}
        onCancel={notice.cancel}
      >
        {corrigendumKind === "extension" && (
          <div className="cd-field">
            <label htmlFor={`${uid}-newdeadline`}>{t("newDeadline")} ({t("istNote")})</label>
            <input id={`${uid}-newdeadline`} type="datetime-local" className={inputCls} value={newDeadline} onChange={(e) => setNewDeadline(e.target.value)} aria-invalid={newDeadline !== "" && extensionInvalid ? true : undefined} />
            {newDeadline !== "" && extensionInvalid && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">{t("extensionMustBeLater")}</p>}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
