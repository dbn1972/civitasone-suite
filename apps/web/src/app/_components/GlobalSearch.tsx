"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./ds/Modal";
import { searchPages, type PageEntry, type PageHit } from "@/lib/nav/pageIndex";
import { useShellT } from "./useShellT";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  module: string;
  name: string;
  refNumber: string | null;
  description: string | null;
  status: string;
  snippet: string;
}

interface SearchResponse {
  data: SearchResult[];
  meta: { page: number; pageSize: number; total: number };
}

/** One row in the listbox: a record hit (gateway search) or a page from the client index. */
type SearchOption =
  | { kind: "record"; key: string; record: SearchResult }
  | { kind: "page"; key: string; hit: PageHit };

// ── Module Badge Colors ───────────────────────────────────────────────────────

const MODULE_COLORS: Record<string, { bg: string; text: string }> = {
  finance: { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-800 dark:text-emerald-200" },
  procurement: { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-800 dark:text-amber-200" },
  hrms: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-800 dark:text-blue-200" },
  payroll: { bg: "bg-indigo-100 dark:bg-indigo-900/30", text: "text-indigo-800 dark:text-indigo-200" },
  projects: { bg: "bg-violet-100 dark:bg-violet-900/30", text: "text-violet-800 dark:text-violet-200" },
  assets: { bg: "bg-slate-100 dark:bg-slate-900/30", text: "text-slate-800 dark:text-slate-200" },
  crm: { bg: "bg-pink-100 dark:bg-pink-900/30", text: "text-pink-800 dark:text-pink-200" },
  helpdesk: { bg: "bg-red-100 dark:bg-red-900/30", text: "text-red-800 dark:text-red-200" },
  legal: { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-800 dark:text-orange-200" },
  citizen: { bg: "bg-teal-100 dark:bg-teal-900/30", text: "text-teal-800 dark:text-teal-200" },
  workflow: { bg: "bg-cyan-100 dark:bg-cyan-900/30", text: "text-cyan-800 dark:text-cyan-200" },
  analytics: { bg: "bg-fuchsia-100 dark:bg-fuchsia-900/30", text: "text-fuchsia-800 dark:text-fuchsia-200" },
  billing: { bg: "bg-lime-100 dark:bg-lime-900/30", text: "text-lime-800 dark:text-lime-200" },
  inventory: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-200" },
  stock: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-200" },
  grants: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-800 dark:text-green-200" },
  audit: { bg: "bg-gray-100 dark:bg-gray-900/30", text: "text-gray-800 dark:text-gray-200" },
  telephony: { bg: "bg-sky-100 dark:bg-sky-900/30", text: "text-sky-800 dark:text-sky-200" },
  knowledge: { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-800 dark:text-purple-200" },
  reports: { bg: "bg-rose-100 dark:bg-rose-900/30", text: "text-rose-800 dark:text-rose-200" },
  contracts: { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-800 dark:text-orange-200" },
  establishment: { bg: "bg-stone-100 dark:bg-stone-900/30", text: "text-stone-800 dark:text-stone-200" },
  notification: { bg: "bg-sky-100 dark:bg-sky-900/30", text: "text-sky-800 dark:text-sky-200" },
  admin: { bg: "bg-neutral-100 dark:bg-neutral-900/30", text: "text-neutral-800 dark:text-neutral-200" },
};

function getModuleColors(module: string): { bg: string; text: string } {
  return MODULE_COLORS[module] ?? { bg: "bg-gray-100 dark:bg-gray-900/30", text: "text-gray-800 dark:text-gray-200" };
}

// ── Module → URL Path Mapping ─────────────────────────────────────────────────

const MODULE_PATH_MAP: Record<string, string> = {
  finance: "/finance",
  procurement: "/procurement",
  hrms: "/hr",
  payroll: "/hr/payroll",
  projects: "/projects",
  assets: "/assets",
  crm: "/crm",
  helpdesk: "/helpdesk",
  legal: "/legal",
  citizen: "/citizen",
  workflow: "/workflow",
  analytics: "/analytics",
  billing: "/billing",
  inventory: "/inventory",
  stock: "/inventory",
  grants: "/grants",
  audit: "/audit",
  telephony: "/telephony",
  knowledge: "/knowledge",
  reports: "/reports",
  contracts: "/contracts",
  establishment: "/estab",
  notification: "/notifications",
  admin: "/admin",
};

// Modules whose detail record actually lives at `/<base>/<id>`. The gateway
// search-route (services/gateway-service/src/search-route.ts) returns only
// `{ module, id }` with NO canonical URL, and for every OTHER module
// `/<base>/<id>` is not a real App Router route; navigating there 404s. So we
// deep-link only where the detail route exists, and otherwise send the clerk to
// the module real landing page (all MODULE_PATH_MAP base paths resolve).
// Verified against the (app) route tree on 2026-08-26.
// HANDOFF: if the gateway search-route is extended to return a canonical `url`
// per hit, prefer that here and this allowlist becomes removable.
const MODULES_WITH_DETAIL_ROUTE = new Set<string>([
  "payroll",
  "projects",
  "assets",
  "grants",
  "reports",
  "contracts",
]);

function buildResultHref(result: SearchResult): string {
  const basePath = MODULE_PATH_MAP[result.module] ?? `/${result.module}`;
  return MODULES_WITH_DETAIL_ROUTE.has(result.module)
    ? `${basePath}/${result.id}`
    : basePath;
}

function optionHref(option: SearchOption): string {
  return option.kind === "record" ? buildResultHref(option.record) : option.hit.entry.href;
}

const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;

// ── Debounce hook ─────────────────────────────────────────────────────────────

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface GlobalSearchProps {
  /** JWT roles claim: the page index only offers pages these roles can open. */
  roles?: string[] | null;
  /** Tenant module keys (null = unknown, show all). */
  enabledModules?: string[] | null;
}

/**
 * Global search (Ctrl+K / Cmd+K, or the top-bar search button).
 *
 * UAT-P3 (NAV-01 / S-01): every query used to answer only "Search is
 * temporarily unavailable" because record search (gateway /api/v1/search ->
 * Meilisearch) was unreachable, and there was no fallback. Two sources now:
 *  - Pages: a client-side index of every page the user can open, with
 *    government abbreviations and Hindi names (lib/nav/pageIndex.ts). It is
 *    synchronous and always answers.
 *  - Records: the gateway search. When it fails, the pages still show,
 *    plus "Record search unavailable — try again." and a retry button.
 * Records are listed first (they are the more specific hit), then pages; the
 * arrow keys move through both as one list.
 */
export function GlobalSearch({ roles, enabledModules }: GlobalSearchProps = {}) {
  const t = useShellT("appNav");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [recordsFailed, setRecordsFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const debouncedQuery = useDebounce(query, 300);

  // ── Keyboard shortcut: Ctrl+K / Meta+K to toggle, Escape to close ─────────
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  // ── Voice nav integration ─────────────────────────────────────────────────
  useEffect(() => {
    function handleVoiceSearch(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (detail) {
        setOpen(true);
        setQuery(detail);
      }
    }
    window.addEventListener("voicenav:search", handleVoiceSearch);
    return () => window.removeEventListener("voicenav:search", handleVoiceSearch);
  }, []);

  // ── Focus input when opened ───────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults([]);
      setTotal(0);
      setRecordsFailed(false);
      setActiveIndex(-1);
    }
  }, [open]);

  // ── Page index: synchronous, so it answers as the user types ──────────────
  const pageLabel = useCallback(
    (e: PageEntry) => t(`${e.kind}.${e.id}`, e.label),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is re-created per render but only reads the stable next-intl messages.
    [],
  );
  const pageHits = useMemo(
    () => (open ? searchPages(query, { roles, enabledModules }, pageLabel) : []),
    [open, query, roles, enabledModules, pageLabel],
  );

  // ── Record search (gateway), debounced ────────────────────────────────────
  useEffect(() => {
    if (!open) return;

    if (debouncedQuery.length < 2) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      setRecordsFailed(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setRecordsFailed(false);

    async function fetchResults() {
      try {
        const params = new URLSearchParams({ q: debouncedQuery, page: "1", pageSize: "20" });
        const res = await fetch(`/api/proxy/v1/search?${params.toString()}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });

        if (!res.ok) {
          // 503 SEARCH_UNAVAILABLE (engine unreachable) or any other failure:
          // the page results stay; the record half says so and offers a retry.
          setRecordsFailed(true);
          setResults([]);
          setTotal(0);
          setLoading(false);
          return;
        }

        const body = (await res.json()) as SearchResponse;
        setResults(Array.isArray(body.data) ? body.data : []);
        setTotal(body.meta?.total ?? 0);
        setActiveIndex(-1);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setRecordsFailed(true);
          setResults([]);
          setTotal(0);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void fetchResults();
    return () => controller.abort();
  }, [debouncedQuery, open, retryNonce]);

  const hasQuery = debouncedQuery.length >= 2;
  const showRecords = hasQuery && !loading && !recordsFailed && results.length > 0;
  const showPages = query.length >= 2 && pageHits.length > 0;

  const options: SearchOption[] = useMemo(
    () => [
      ...(showRecords ? results.map<SearchOption>((r) => ({ kind: "record", key: `r-${r.module}-${r.id}`, record: r })) : []),
      ...(showPages ? pageHits.map<SearchOption>((h) => ({ kind: "page", key: `p-${h.entry.href}`, hit: h })) : []),
    ],
    [showRecords, results, showPages, pageHits],
  );

  // Keep the highlight inside the list when it shrinks.
  useEffect(() => {
    if (activeIndex >= options.length) setActiveIndex(options.length > 0 ? 0 : -1);
  }, [options.length, activeIndex]);

  const navigate = useCallback(
    (option: SearchOption) => {
      setOpen(false);
      router.push(optionHref(option));
    },
    [router],
  );

  // ── Keyboard navigation within the dialog ─────────────────────────────────
  // Attached at the document level (not a JSX onKeyDown prop on the
  // role="dialog" panel) so it does not trip jsx-a11y
  // non-interactive-element-interactions; guarded to fire only while the
  // search input itself is focused.
  const handleDialogKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (document.activeElement !== inputRef.current || options.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = prev < options.length - 1 ? prev + 1 : 0;
          scrollToItem(next);
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = prev > 0 ? prev - 1 : options.length - 1;
          scrollToItem(next);
          return next;
        });
      } else if (e.key === "Enter" && activeIndex >= 0 && options[activeIndex]) {
        e.preventDefault();
        navigate(options[activeIndex]);
      }
    },
    [options, activeIndex, navigate],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleDialogKeyDown);
    return () => document.removeEventListener("keydown", handleDialogKeyDown);
  }, [open, handleDialogKeyDown]);

  function scrollToItem(index: number) {
    const item = document.getElementById(`search-result-${index}`);
    if (item && typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "nearest" });
    }
  }

  if (!open) return null;

  const showEmpty = hasQuery && !loading && !recordsFailed && results.length === 0 && pageHits.length === 0;
  const showNoRecords = hasQuery && !loading && !recordsFailed && results.length === 0 && pageHits.length > 0;
  const showHint = query.length < 2 && !loading;
  const recordCount = showRecords ? total : 0;
  const recordsAnnouncement = hasQuery && !loading && !recordsFailed
    ? results.length > 0
      ? t("search.resultsFound", plural(total, "result found", "results found"), { count: total })
      : pageHits.length === 0
        ? t("search.noResultsSr", "No results found for {query}", { query: debouncedQuery })
        : ""
    : "";
  const pagesAnnouncement = showPages
    ? t("search.pagesFound", plural(pageHits.length, "matching page", "matching pages"), { count: pageHits.length })
    : "";

  const renderOption = (option: SearchOption, index: number) => {
    const selected = index === activeIndex;
    const common = {
      id: `search-result-${index}`,
      role: "option" as const,
      "aria-selected": selected,
      className: `flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
        selected ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-800"
      }`,
      onClick: () => navigate(option),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(option);
        }
      },
      onMouseEnter: () => setActiveIndex(index),
    };
    if (option.kind === "record") {
      const result = option.record;
      return (
        <li key={option.key} {...common}>
          <span
            className={`inline-flex items-center shrink-0 mt-0.5 px-1.5 py-0.5 text-xs font-semibold uppercase rounded ${getModuleColors(result.module).bg} ${getModuleColors(result.module).text}`}
          >
            {result.module}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{result.name}</span>
              {result.refNumber && (
                <span className="text-xs text-gray-600 dark:text-gray-300 shrink-0">{result.refNumber}</span>
              )}
            </div>
            {result.snippet && (
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 line-clamp-1">{result.snippet}</p>
            )}
          </div>
          {result.status && result.status !== "unknown" && (
            <span className="text-xs text-gray-600 dark:text-gray-300 shrink-0 mt-1">{result.status}</span>
          )}
        </li>
      );
    }
    const { entry, label } = option.hit;
    return (
      <li key={option.key} {...common}>
        <span className="inline-flex items-center shrink-0 mt-0.5 px-1.5 py-0.5 text-xs font-semibold rounded bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100">
          {t("search.pageBadge", "Page")}
        </span>
        <div className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{label}</span>
          <span className="block text-xs text-gray-600 dark:text-gray-300 truncate">
            {t(`group.${entry.groupId}`, entry.groupLabel)} · {entry.href}
          </span>
        </div>
      </li>
    );
  };

  const recordOptions = options.filter((o) => o.kind === "record");
  const pageOptions = options.filter((o) => o.kind === "page");

  // SF-19: ds/Modal (focus trap, inert background, Escape, focus restore) replaces the
  // hand-rolled dialog. The heading is visually hidden: a command palette shows its
  // input, not a title.
  return (
    <Modal
      open
      onClose={() => setOpen(false)}
      title={t("search.title", "Global search")}
      titleClassName="sr-only"
      zIndex={9999}
      overlayClassName="!place-items-start !pt-[15vh]"
      panelClassName="relative !max-w-[560px] !p-0 bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700"
    >
      <div>
        {/* Input row */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <svg
            className="w-4 h-4 text-gray-500 shrink-0"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder", "Search pages and records… (e.g. DDO, JV, PO/2026)")}
            aria-label={t("search.inputLabel", "Global search")}
            aria-autocomplete="list"
            aria-controls="search-results-list"
            aria-expanded={options.length > 0}
            aria-activedescendant={activeIndex >= 0 && options[activeIndex] ? `search-result-${activeIndex}` : undefined}
            role="combobox"
            className="flex-1 min-w-0 border-none outline-none text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-500"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" aria-label={t("search.searching", "Searching")} role="status" />
          )}
          <kbd className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300">
            ESC
          </kbd>
        </div>

        {/* Results: one listbox, records first, then pages. */}
        <ul
          id="search-results-list"
          role="listbox"
          aria-label={t("search.resultsList", "Search results")}
          className="max-h-[360px] overflow-y-auto"
        >
          {recordOptions.length > 0 && (
            <li role="group" aria-labelledby="search-group-records">
              <div id="search-group-records" role="presentation" className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                {t("search.records", "Records")}
              </div>
              <ul role="none">{recordOptions.map((o) => renderOption(o, options.indexOf(o)))}</ul>
            </li>
          )}
          {pageOptions.length > 0 && (
            <li role="group" aria-labelledby="search-group-pages">
              <div id="search-group-pages" role="presentation" className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                {t("search.pages", "Pages")}
              </div>
              <ul role="none">{pageOptions.map((o) => renderOption(o, options.indexOf(o)))}</ul>
            </li>
          )}
        </ul>

        {/* Record search failed: pages above still answer. */}
        {hasQuery && recordsFailed && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-red-700 dark:text-red-300 border-t border-gray-200 dark:border-gray-700" role="alert">
            <span>{t("search.recordsUnavailable", "Record search unavailable — try again.")}</span>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setRetryNonce((n) => n + 1);
                inputRef.current?.focus();
              }}
            >
              {t("search.retry", "Try again")}
            </button>
          </div>
        )}

        {showNoRecords && (
          <div className="px-4 py-2 text-xs text-gray-600 dark:text-gray-300 border-t border-gray-200 dark:border-gray-700">
            {t("search.noRecords", "No matching records")}
          </div>
        )}

        {showEmpty && (
          <div className="px-4 py-8 text-center text-sm text-gray-600 dark:text-gray-300" role="status">
            {t("search.noResults", "No results found for “{query}”", { query: debouncedQuery })}
          </div>
        )}

        {showHint && (
          <div className="px-4 py-8 text-center text-sm text-gray-600 dark:text-gray-300">
            {t("search.hint", "Type at least 2 characters to search")}
          </div>
        )}

        {/* Live region for screen readers: record count and page count. */}
        <div aria-live="polite" aria-atomic="true" className="sr-only" role="status">
          {recordsAnnouncement ? <span>{recordsAnnouncement}</span> : null}
          {recordsAnnouncement && pagesAnnouncement ? " " : null}
          {pagesAnnouncement ? <span>{pagesAnnouncement}</span> : null}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs">↑↓</kbd>
            {t("search.navigate", "navigate")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs">↵</kbd>
            {t("search.open", "open")}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs">esc</kbd>
            {t("search.close", "close")}
          </span>
          {recordCount > 0 && (
            <span className="ms-auto">{t("search.footerCount", plural(recordCount, "result", "results"), { count: recordCount })}</span>
          )}
        </div>
      </div>
    </Modal>
  );
}
