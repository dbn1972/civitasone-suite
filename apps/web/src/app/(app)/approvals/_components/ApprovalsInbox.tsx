"use client";

/**
 * UX R1: the one approvals inbox. Tabs (waiting / sent / done) are server-rendered links; this
 * component filters, pages and navigates the rows of the current tab and hosts the decision panel.
 *
 * Accessibility: a real <table> with caption and column headers (rows stack below 640 px with
 * per-cell labels); each row opens through a native button; J/K or the arrow keys move between
 * rows, Enter opens; a polite live region announces the list size and every decision; after a
 * decision focus moves to the next row and the panel opens it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { EmptyState } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import {
  COUNTS_EVENT, MODULES, NO_FILTERS, TYPE_KEYS, applyFilters, buildRows, personLabel, sortRows,
  type InboxCounts, type InboxFilters, type InboxRow, type InboxTab, type InboxTask, type ModuleKey, type RefSummary,
} from "../_lib/inboxModel";
import { DecisionPanel, type DecisionKind } from "./DecisionPanel";
import { InboxTabs } from "./InboxTabs";
import { ageText, amountText, slaText, slaTone, stageText, taskTitle, type T } from "./rowText";
import styles from "./inbox.module.css";

export const PAGE_SIZE = 25;

export interface ApprovalsInboxProps {
  tab: InboxTab;
  tasks: InboxTask[];
  summaries: RefSummary[];
  counts: InboxCounts | null;
  /** Server total for this tab (may exceed the loaded window). */
  total: number;
  initialModule?: ModuleKey | "all";
  initialTaskId?: string | null;
  /** Server-side search already applied (?q=). */
  serverQuery?: string;
  tabLabels: { nav: string } & Record<InboxTab, string>;
  /** Injectable clock and fetch for tests. */
  now?: number;
  fetchImpl?: typeof fetch;
}

function emitCounts(counts: InboxCounts) {
  try {
    window.dispatchEvent(new CustomEvent(COUNTS_EVENT, { detail: counts }));
    window.sessionStorage.setItem(COUNTS_EVENT, JSON.stringify({ at: Date.now(), counts }));
  } catch {
    /* storage blocked: the badge refetches */
  }
}

export function ApprovalsInbox({ tab, tasks, summaries, counts: initialCounts, total, initialModule = "all", initialTaskId = null, serverQuery = "", tabLabels, now, fetchImpl }: ApprovalsInboxProps) {
  const t = useTranslations("approvalsInbox") as unknown as T;
  const [clock] = useState(() => now ?? Date.now());
  const [allRows, setAllRows] = useState<InboxRow[]>(() => buildRows(tasks, summaries, clock));
  const [counts, setCounts] = useState<InboxCounts | null>(initialCounts);
  const [filters, setFilters] = useState<InboxFilters>({ ...NO_FILTERS, module: initialModule });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId && tasks.some((x) => x.id === initialTaskId) ? initialTaskId : null);
  const [announcement, setAnnouncement] = useState("");
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<string | null>(null);
  // After a decision the decision itself is announced; the list-size announcement waits.
  const skipCountAnnounce = useRef(false);

  useEffect(() => { if (counts) emitCounts(counts); }, [counts]);

  const visible = useMemo(() => sortRows(applyFilters(allRows, filters), tab), [allRows, filters, tab]);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const overdueVisible = visible.filter((r) => r.sla.state === "overdue").length;
  const selected = allRows.find((r) => r.task.id === selectedId) ?? null;

  // Announce the list size whenever the filters change it.
  useEffect(() => {
    if (skipCountAnnounce.current) { skipCountAnnounce.current = false; return; }
    setAnnouncement(t("announce.count", { count: visible.length, overdue: overdueVisible }));
  }, [visible.length, overdueVisible, t]);

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    rowButtons.current.get(id)?.focus();
  });

  const setFilter = <K extends keyof InboxFilters>(k: K, v: InboxFilters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const open = useCallback((id: string) => {
    setSelectedId(id);
    // On narrow screens the panel sits below the list: move to it.
    requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const keys = ["j", "k", "ArrowDown", "ArrowUp"];
    if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const ids = pageRows.map((r) => r.task.id);
    const current = ids.findIndex((id) => rowButtons.current.get(id) === document.activeElement);
    const delta = e.key === "j" || e.key === "ArrowDown" ? 1 : -1;
    const next = Math.min(ids.length - 1, Math.max(0, (current < 0 ? (delta > 0 ? -1 : ids.length) : current) + delta));
    const target = ids[next];
    if (target) {
      e.preventDefault();
      rowButtons.current.get(target)?.focus();
    }
  };

  const onDecided = useCallback((taskId: string, decision: DecisionKind, message: string) => {
    const idx = visible.findIndex((r) => r.task.id === taskId);
    const removed = allRows.find((r) => r.task.id === taskId);
    const rest = visible.filter((r) => r.task.id !== taskId);
    const next = rest[Math.min(Math.max(idx, 0), rest.length - 1)] ?? null;
    setAllRows((rows) => rows.filter((r) => r.task.id !== taskId));
    setCounts((c) => c && {
      ...c,
      waiting: Math.max(0, c.waiting - 1),
      overdue: Math.max(0, c.overdue - (removed?.sla.state === "overdue" ? 1 : 0)),
      done: decision === "forward" ? c.done : c.done + 1,
    });
    setSelectedId(next?.task.id ?? null);
    if (next) {
      const nextIdx = rest.indexOf(next);
      setPage(Math.floor(nextIdx / PAGE_SIZE) + 1);
      pendingFocus.current = next.task.id;
    }
    skipCountAnnounce.current = true;
    setAnnouncement(t(next ? "announce.decided" : "announce.decidedLast", { message }));
  }, [visible, allRows, t]);

  const loadedAll = allRows.length >= total || tasks.length >= total;
  const tabCount = counts ? counts[tab] : total;
  const emptyTitle = t(`empty.${tab}Title`);
  const emptyMessage = t(`empty.${tab}Message`);

  return (
    <div>
      <InboxTabs tab={tab} counts={counts} module={initialModule} labels={tabLabels} />
      <p className={styles.hint}>{t(`tabHint.${tab}`)}</p>

      {allRows.length > 0 && (
        <>
          <div className={styles.chips} role="group" aria-label={t("chips.label")}>
            <button type="button" className={styles.chip} aria-pressed={filters.sla === "all"} onClick={() => setFilter("sla", "all")}>{t("chips.all", { count: tabCount })}</button>
            {tab !== "done" && (
              <>
                <button type="button" className={styles.chip} aria-pressed={filters.sla === "overdue"} onClick={() => setFilter("sla", "overdue")}>{t("chips.overdue", { count: allRows.filter((r) => r.sla.state === "overdue").length })}</button>
                <button type="button" className={styles.chip} aria-pressed={filters.sla === "dueToday"} onClick={() => setFilter("sla", "dueToday")}>{t("chips.dueToday", { count: allRows.filter((r) => r.sla.state === "dueToday").length })}</button>
              </>
            )}
          </div>

          <form className={styles.filters} role="search" aria-label={t("filters.heading")} method="get" onSubmit={(e) => { if (loadedAll) e.preventDefault(); }}>
            <input type="hidden" name="tab" value={tab} />
            <label>
              {t("filters.search")}
              <input type="search" name="q" defaultValue={serverQuery} onChange={(e) => setFilter("q", e.target.value)} autoComplete="off" />
            </label>
            <label>
              {t("filters.module")}
              <select value={filters.module} onChange={(e) => setFilter("module", e.target.value as InboxFilters["module"])}>
                <option value="all">{t("filters.all")}</option>
                {MODULES.map((m) => <option key={m} value={m}>{t(`modules.${m}`)}</option>)}
              </select>
            </label>
            <label>
              {t("filters.type")}
              <select value={filters.type} onChange={(e) => setFilter("type", e.target.value as InboxFilters["type"])}>
                <option value="all">{t("filters.all")}</option>
                {TYPE_KEYS.map((k) => <option key={k} value={k}>{t(`types.${k}`)}</option>)}
              </select>
            </label>
            {tab !== "done" && (
              <label>
                {t("filters.sla")}
                <select value={filters.sla} onChange={(e) => setFilter("sla", e.target.value as InboxFilters["sla"])}>
                  <option value="all">{t("filters.all")}</option>
                  <option value="overdue">{t("filters.slaOverdue")}</option>
                  <option value="dueToday">{t("filters.slaDueToday")}</option>
                  <option value="dueSoon">{t("filters.slaDueSoon")}</option>
                </select>
              </label>
            )}
            <label>
              {t("filters.minAmount")}
              <input inputMode="decimal" value={filters.minAmount} placeholder={t("filters.amountHint")} onChange={(e) => setFilter("minAmount", e.target.value)} />
            </label>
            <label>
              {t("filters.maxAmount")}
              <input inputMode="decimal" value={filters.maxAmount} placeholder={t("filters.amountHint")} onChange={(e) => setFilter("maxAmount", e.target.value)} />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              {!loadedAll && <button type="submit" className="btn ghost sm">{t("searchAll")}</button>}
              <button type="button" className="btn ghost sm" onClick={() => { setFilters({ ...NO_FILTERS }); setPage(1); }}>{t("filters.clear")}</button>
            </div>
          </form>
          {!loadedAll && <p className={styles.hint} role="note">{t("capNotice", { shown: allRows.length, total })}</p>}
          <p className={styles.hint}>{t("keyboardHint")}</p>
        </>
      )}

      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      <div className={styles.layout}>
        <div className={styles.listCard}>
          {allRows.length === 0 ? (
            <div style={{ padding: 16 }}><EmptyState icon="✅" title={emptyTitle} message={emptyMessage} /></div>
          ) : visible.length === 0 ? (
            <p style={{ padding: 16 }} role="status">{t("empty.filtered")}</p>
          ) : (
            <>
              <table className={styles.table}>
                <caption>{t(`caption.${tab}`, { count: visible.length })}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("columns.item")}</th>
                    <th scope="col" className={styles.num}>{t("columns.amount")}</th>
                    <th scope="col">{tab === "done" ? t("columns.decision") : t("columns.due")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => {
                    const title = taskTitle(t, row);
                    const from = personLabel(row.maker) ?? t("nameNotRecorded");
                    const stage = stageText(t, row.summary?.stage);
                    const isSel = row.task.id === selectedId;
                    return (
                      <tr key={row.task.id} className={styles.row} data-selected={isSel ? "true" : undefined}>
                        <td data-label={t("columns.item")}>
                          <span className={styles.typeChip}>{t(`types.${row.type}`)}</span>
                          <button
                            type="button"
                            className={styles.rowButton}
                            ref={(el) => { if (el) rowButtons.current.set(row.task.id, el); else rowButtons.current.delete(row.task.id); }}
                            aria-current={isSel ? "true" : undefined}
                            aria-label={t("openItem", { title })}
                            onClick={() => open(row.task.id)}
                            onKeyDown={onKeyDown}
                          >
                            {title}
                          </button>
                          <span className={styles.sub}>{t("columns.from")}: {from}</span>
                          {stage && <span className={styles.sub}>{stage}</span>}
                          {tab !== "done" && ageText(t, row.age) && <span className={styles.sub}>{ageText(t, row.age)}</span>}
                        </td>
                        <td data-label={t("columns.amount")} className={styles.num}>{amountText(t, row.amountMinor)}</td>
                        <td data-label={tab === "done" ? t("columns.decision") : t("columns.due")}>
                          {tab === "done" ? (
                            <>
                              <span className="pill mut">{t(`decision.${["approve", "reject", "return"].includes(row.task.decision ?? "") ? row.task.decision : "other"}`)}</span>
                              {row.task.completedAt && <span className={styles.sub}>{formatIndianDate(row.task.completedAt)}</span>}
                            </>
                          ) : (
                            <span className={`pill ${slaTone(row.sla.state)}`}>{slaText(t, row.sla, row.task.dueAt)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {pages > 1 && (
                <nav className={styles.pager} aria-label={t("pager.label")}>
                  <button type="button" className="btn ghost sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>{t("pager.prev")}</button>
                  <span>{t("pager.status", { page: safePage, pages })}</span>
                  <button type="button" className="btn ghost sm" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}>{t("pager.next")}</button>
                </nav>
              )}
            </>
          )}
        </div>
        <div>
          {selected ? (
            <DecisionPanel
              row={selected}
              tab={tab}
              onDecided={onDecided}
              onClose={() => { const id = selected.task.id; setSelectedId(null); pendingFocus.current = id; }}
              headingRef={headingRef}
              {...(fetchImpl ? { fetchImpl } : {})}
            />
          ) : allRows.length > 0 ? (
            <div className={styles.panel}><p className={styles.muted} style={{ margin: 0 }}>{t("selectPrompt")}</p></div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
