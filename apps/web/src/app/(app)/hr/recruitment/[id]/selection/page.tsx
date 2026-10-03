"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, ConfirmDialog, StatusPill, useConfirmAction } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";
import { useSessionIdentity } from "@/lib/auth/useSessionIdentity";
import { approvalBlock, autoRank, buildEntries, isNoLists, type EditorError, type EditorRow } from "./selectionEditor";

type SelectionList = {
  id: string; title: string; vacancies: number; status: string; validityUntil: string | null;
  createdBy: string; entriesSetBy: string | null; withinValidity?: boolean;
};
type Entry = { applicationId: string; candidateName: string; category: "selected" | "waitlist"; rank: number; score: string | null };
type PoolApp = { id: string; applicantName: string; screeningDecision: string };

const SELECTION_ADMIN = ["hr_admin", "super_admin"];
const inputClass = "rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-slate-800 dark:text-slate-200";

/**
 * GAP-RECRUITMENT-DETAIL-14: merit / wait list for one vacancy. The service enforces maker-checker (the list's
 * creator or ranking author cannot approve it), the validity period and publish-after-approve; this page only
 * drives those endpoints and says why when the service refuses.
 */
export default function SelectionListsPage() {
  const t = useTranslations("recruitmentFinish");
  const { id } = useParams<{ id: string }>();
  const formError = useFormError("selection list");
  const who = useSessionIdentity();
  const uid = useId();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [lists, setLists] = useState<SelectionList[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pool, setPool] = useState<PoolApp[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ list: SelectionList; entries: Entry[] } | null>(null);
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [title, setTitle] = useState("");
  const [vacancies, setVacancies] = useState("1");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const isAdmin = who.roles.some((r) => SELECTION_ADMIN.includes(r));

  const loadLists = useCallback(async () => {
    try {
      const res = await fetch(`/api/proxy/v1/hrms/job-openings/${id}/selection-lists`);
      if (!res.ok) { if (mounted.current) setLoadFailed(true); return; }
      const j = (await res.json()) as { data?: SelectionList[] };
      if (mounted.current) { setLists(j.data ?? []); setLoadFailed(false); }
    } catch { if (mounted.current) setLoadFailed(true); }
  }, [id]);

  const loadPool = useCallback(async () => {
    try {
      const res = await fetch(`/api/proxy/v1/hrms/job-openings/${id}/applications`);
      if (!res.ok) return;
      const j = (await res.json()) as { data?: PoolApp[] };
      if (mounted.current) setPool((j.data ?? []).filter((a) => a.screeningDecision === "shortlisted" || a.screeningDecision === "eligible"));
    } catch { /* the editor then offers no candidates; the list view still works */ }
  }, [id]);

  const loadDetail = useCallback(async (listId: string) => {
    try {
      const res = await fetch(`/api/proxy/v1/hrms/selection-lists/${listId}`);
      if (!res.ok) { setMessage({ kind: "error", text: t("selLoadFailed") }); return; }
      const j = (await res.json()) as SelectionList & { entries?: Entry[] };
      if (!mounted.current) return;
      setDetail({ list: j, entries: j.entries ?? [] });
    } catch { setMessage({ kind: "error", text: t("selLoadFailed") }); }
  }, [t]);

  useEffect(() => { void loadLists(); void loadPool(); }, [loadLists, loadPool]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

  // Editor rows: every candidate in the screened pool, pre-filled from the saved entries.
  useEffect(() => {
    if (!detail) { setRows([]); return; }
    const byApp = new Map(detail.entries.map((e) => [e.applicationId, e]));
    setRows(pool.map((p) => {
      const e = byApp.get(p.id);
      return { applicationId: p.id, name: p.applicantName, category: e ? e.category : "none", rank: e ? String(e.rank) : "", score: e?.score ?? "" };
    }));
  }, [detail, pool]);

  /** Runs one request. Returns null on success, or the plain-language reason it was refused. */
  async function call(path: string, init: RequestInit, okText: string): Promise<string | null> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/proxy${path}`, { headers: { "content-type": "application/json" }, ...init });
      if (!res.ok) {
        const env = (await res.clone().json().catch(() => null)) as { code?: string } | null;
        const text = env?.code === "SOD_VIOLATION" ? t("selSod")
          : env?.code === "FORBIDDEN" ? t("selForbidden")
          : env?.code === "INVALID_ENTRIES" ? t("selInvalidEntries")
          : env?.code === "INVALID_VALIDITY" ? t("selInvalidValidity")
          : env?.code === "NOT_DRAFT" ? t("selNotDraft")
          : (await formError.fromResponse(res, "save")).message;
        setMessage({ kind: "error", text });
        return text;
      }
      setMessage({ kind: "ok", text: okText });
      await loadLists();
      if (selectedId) {
        await loadDetail(selectedId);
        // Writes are queued (202): read once more shortly after.
        setTimeout(() => { if (mounted.current && selectedId) { void loadDetail(selectedId); void loadLists(); } }, 1200);
      }
      return null;
    } catch {
      const text = formError.fromException("save").message;
      setMessage({ kind: "error", text });
      return text;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function createList(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(vacancies);
    if (!title.trim() || !Number.isInteger(n) || n < 1) { setMessage({ kind: "error", text: t("selCreateInvalid") }); return; }
    if ((await call(`/v1/hrms/job-openings/${id}/selection-lists`, { method: "POST", body: JSON.stringify({ title: title.trim(), vacancies: n }) }, t("selCreated"))) === null) setTitle("");
  }

  const errorText = (e: EditorError) => ({
    no_entries: t("selErrNoEntries"), rank_invalid: t("selErrRankInvalid"), rank_not_contiguous: t("selErrRankGaps"),
    too_many_selected: t("selErrTooMany"), score_invalid: t("selErrScore"),
  })[e];

  async function saveEntries() {
    if (!detail) return;
    const built = buildEntries(rows, detail.list.vacancies);
    if (!built.ok) { setMessage({ kind: "error", text: errorText(built.error) }); return; }
    await call(`/v1/hrms/selection-lists/${detail.list.id}/entries`, { method: "PUT", body: JSON.stringify({ entries: built.entries }) }, t("selEntriesSaved"));
  }

  const approve = useConfirmAction({
    onConfirm: async () => {
      if (!detail) return;
      if (!validUntil) throw new Error(t("selValidityRequired"));
      const err = await call(`/v1/hrms/selection-lists/${detail.list.id}/approve`, { method: "POST", body: JSON.stringify({ validUntil: `${validUntil}T00:00:00.000Z` }) }, t("selApproved"));
      if (err) throw new Error(err);
    },
  });
  const publish = useConfirmAction({
    onConfirm: async () => {
      if (!detail) return;
      const err = await call(`/v1/hrms/selection-lists/${detail.list.id}/publish`, { method: "POST", body: "{}" }, t("selPublished"));
      if (err) throw new Error(err);
    },
  });
  const expire = useConfirmAction({
    onConfirm: async () => {
      if (!detail) return;
      const err = await call(`/v1/hrms/selection-lists/${detail.list.id}/expire`, { method: "POST", body: "{}" }, t("selExpired"));
      if (err) throw new Error(err);
    },
  });

  const block = useMemo(() => (detail ? approvalBlock(detail.list, who.userId) : null), [detail, who.userId]);
  const setRow = (appId: string, patch: Partial<EditorRow>) => setRows((rs) => rs.map((r) => (r.applicationId === appId ? { ...r, ...patch } : r)));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="page-main" aria-labelledby="sel-heading">
      <Link href={`/hr/recruitment/${id}`} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">{t("backToVacancy")}</Link>
      <h1 id="sel-heading" className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1">{t("selHeading")}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t("selIntro")}</p>

      {message && <p role={message.kind === "error" ? "alert" : "status"} className={`mb-3 text-sm ${message.kind === "error" ? "text-red-600" : "text-emerald-700"}`}>{message.text}</p>}

      <form onSubmit={createList} className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-4" aria-label={t("selCreate")}>
        <div>
          <label htmlFor={`${uid}-title`} className="block text-xs font-semibold mb-1">{t("selTitleLabel")}</label>
          <input id={`${uid}-title`} className={inputClass} value={title} maxLength={256} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div>
          <label htmlFor={`${uid}-vac`} className="block text-xs font-semibold mb-1">{t("selVacancies")}</label>
          <input id={`${uid}-vac`} type="number" min={1} className={`${inputClass} w-24`} value={vacancies} onChange={(e) => setVacancies(e.target.value)} required />
        </div>
        <Button type="submit" disabled={busy}>{t("selCreate")}</Button>
      </form>

      {loadFailed ? (
        <p role="alert" className="text-sm text-red-600">{t("selLoadFailed")} <button type="button" className="underline" onClick={() => { setLoadFailed(false); void loadLists(); }}>{t("retry")}</button></p>
      ) : lists === null ? (
        <p role="status" className="text-sm text-slate-500">{t("selLoading")}</p>
      ) : isNoLists(lists) ? (
        <p className="text-sm text-slate-500">{t("selNone")}</p>
      ) : (
        <ul className="flex flex-col gap-2 mb-6" aria-label={t("selHeading")}>
          {lists.map((l) => (
            <li key={l.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{l.title}</p>
                <p className="text-xs text-slate-500">{t("selMeta", { vacancies: l.vacancies, until: l.validityUntil ? formatIndianDate(l.validityUntil) : "—" })}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill status={l.status} />
                <Button variant="secondary" size="sm" aria-pressed={selectedId === l.id} onClick={() => setSelectedId(selectedId === l.id ? null : l.id)}>
                  {selectedId === l.id ? t("selClose") : t("selOpen")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {detail && (
        <section aria-label={detail.list.title} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <h2 className="text-base font-semibold mb-2">{detail.list.title}</h2>

          {detail.list.status === "draft" ? (
            <>
              <table className="w-full text-xs mb-3">
                <thead><tr className="text-start text-slate-500">
                  <th scope="col" className="text-start font-medium py-1">{t("selCandidate")}</th>
                  <th scope="col" className="text-start font-medium py-1">{t("selPlacement")}</th>
                  <th scope="col" className="text-start font-medium py-1">{t("selRank")}</th>
                  <th scope="col" className="text-start font-medium py-1">{t("selScore")}</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.applicationId} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1 pe-2">{r.name}</td>
                      <td className="py-1 pe-2">
                        <select aria-label={t("selPlacementFor", { name: r.name })} className={inputClass} value={r.category} onChange={(e) => setRow(r.applicationId, { category: e.target.value as EditorRow["category"] })}>
                          <option value="none">{t("selNotListed")}</option>
                          <option value="selected">{t("selSelected")}</option>
                          <option value="waitlist">{t("selWaitlist")}</option>
                        </select>
                      </td>
                      <td className="py-1 pe-2"><input aria-label={t("selRankFor", { name: r.name })} type="number" min={1} className={`${inputClass} w-20`} value={r.rank} disabled={r.category === "none"} onChange={(e) => setRow(r.applicationId, { rank: e.target.value })} /></td>
                      <td className="py-1"><input aria-label={t("selScoreFor", { name: r.name })} type="number" step="any" className={`${inputClass} w-24`} value={r.score} disabled={r.category === "none"} onChange={(e) => setRow(r.applicationId, { score: e.target.value })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => setRows((rs) => autoRank(rs))}>{t("selAutoRank")}</Button>
                <Button disabled={busy} onClick={() => void saveEntries()}>{t("selSaveEntries")}</Button>
              </div>
            </>
          ) : (
            <ol className="text-sm list-decimal ps-5">
              {detail.entries.map((e) => <li key={`${e.category}-${e.rank}`}>{e.candidateName} · {e.category === "selected" ? t("selSelected") : t("selWaitlist")} #{e.rank}</li>)}
            </ol>
          )}

          {isAdmin && (
            <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
              {detail.list.status === "draft" && (
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label htmlFor={`${uid}-valid`} className="block text-xs font-semibold mb-1">{t("selValidUntil")}</label>
                    <input id={`${uid}-valid`} type="date" min={today} className={inputClass} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                  </div>
                  <Button disabled={busy || block === "maker" || !validUntil} onClick={() => approve.trigger()}>{t("selApprove")}</Button>
                  {block === "maker" && <p className="text-xs text-slate-600 dark:text-slate-300">{t("selYouAreMaker")}</p>}
                </div>
              )}
              {detail.list.status === "approved" && <div><Button disabled={busy} onClick={() => publish.trigger()}>{t("selPublish")}</Button></div>}
              {(detail.list.status === "approved" || detail.list.status === "published") && <div><Button variant="danger" disabled={busy} onClick={() => expire.trigger()}>{t("selExpire")}</Button></div>}
            </div>
          )}
          {!isAdmin && who.loaded && <p className="mt-3 text-xs text-slate-500">{t("selAdminOnly")}</p>}
        </section>
      )}

      <ConfirmDialog open={approve.open} title={t("selApproveTitle")} description={t("selApproveDescription", { date: validUntil ? formatIndianDate(validUntil) : "—" })} confirmLabel={t("selApprove")} busy={approve.busy} errorMessage={approve.error} onConfirm={approve.confirm} onCancel={approve.cancel} />
      <ConfirmDialog open={publish.open} title={t("selPublishTitle")} description={t("selPublishDescription")} confirmLabel={t("selPublish")} busy={publish.busy} errorMessage={publish.error} onConfirm={publish.confirm} onCancel={publish.cancel} />
      <ConfirmDialog open={expire.open} title={t("selExpireTitle")} description={t("selExpireDescription")} confirmLabel={t("selExpire")} danger busy={expire.busy} errorMessage={expire.error} onConfirm={expire.confirm} onCancel={expire.cancel} />
    </div>
  );
}
