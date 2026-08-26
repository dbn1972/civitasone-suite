"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

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
// `/<base>/<id>` is not a real App Router route — navigating there 404s. So we
// deep-link only where the detail route exists, and otherwise send the clerk to
// the module's real landing page (all MODULE_PATH_MAP base paths resolve).
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

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const router = useRouter();

  const debouncedQuery = useDebounce(query, 300);

  // ── Keyboard shortcut: Ctrl+K / Meta+K to toggle, Escape to close ─────────
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
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
      setError(null);
      setActiveIndex(-1);
    }
  }, [open]);

  // ── Fetch search results when debounced query changes ─────────────────────
  useEffect(() => {
    if (!open) return;

    if (debouncedQuery.length < 2) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    async function fetchResults() {
      try {
        const params = new URLSearchParams({ q: debouncedQuery, page: "1", pageSize: "20" });
        const res = await fetch(`/api/proxy/v1/search?${params.toString()}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });

        if (res.status === 503) {
          setError("Search is temporarily unavailable");
          setResults([]);
          setTotal(0);
          setLoading(false);
          return;
        }

        if (!res.ok) {
          setError("Search failed");
          setResults([]);
          setTotal(0);
          setLoading(false);
          return;
        }

        const body = (await res.json()) as SearchResponse;
        setResults(body.data);
        setTotal(body.meta.total);
        setActiveIndex(-1);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError("Unable to reach search service");
          setResults([]);
          setTotal(0);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void fetchResults();
    return () => controller.abort();
  }, [debouncedQuery, open]);

  // ── Keyboard navigation within the dialog ─────────────────────────────────
  const handleDialogKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = prev < results.length - 1 ? prev + 1 : 0;
          scrollToItem(next);
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = prev > 0 ? prev - 1 : results.length - 1;
          scrollToItem(next);
          return next;
        });
      } else if (e.key === "Enter" && activeIndex >= 0 && results[activeIndex]) {
        e.preventDefault();
        navigate(results[activeIndex]);
      }
    },
    [results, activeIndex],
  );

  function scrollToItem(index: number) {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[index] as HTMLElement | undefined;
    if (item && typeof item.scrollIntoView === "function") {
      item.scrollIntoView({ block: "nearest" });
    }
  }

  function navigate(result: SearchResult) {
    setOpen(false);
    router.push(buildResultHref(result));
  }

  if (!open) return null;

  const hasQuery = debouncedQuery.length >= 2;
  const showResults = hasQuery && !loading && !error && results.length > 0;
  const showEmpty = hasQuery && !loading && !error && results.length === 0;
  const showHint = !hasQuery && !loading;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      role="presentation"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
        className="relative w-full max-w-[560px] bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700"
        onKeyDown={handleDialogKeyDown}
      >
        {/* Input row */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <svg
            className="w-4 h-4 text-gray-400 shrink-0"
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
            placeholder="Search across all modules…"
            aria-label="Global search"
            aria-autocomplete="list"
            aria-controls="search-results-list"
            aria-expanded={showResults}
            aria-activedescendant={activeIndex >= 0 ? `search-result-${activeIndex}` : undefined}
            role="combobox"
            className="flex-1 border-none outline-none text-sm bg-transparent text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" aria-label="Searching" role="status" />
          )}
          <kbd className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <ul
          id="search-results-list"
          ref={listRef}
          role="listbox"
          aria-label="Search results"
          className="max-h-[360px] overflow-y-auto"
        >
          {showResults &&
            results.map((result, index) => (
              <li
                key={result.id}
                id={`search-result-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                  index === activeIndex
                    ? "bg-blue-50 dark:bg-blue-900/20"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                onClick={() => navigate(result)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {/* Module badge */}
                <span
                  className={`inline-flex items-center shrink-0 mt-0.5 px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded ${getModuleColors(result.module).bg} ${getModuleColors(result.module).text}`}
                >
                  {result.module}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {result.name}
                    </span>
                    {result.refNumber && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                        {result.refNumber}
                      </span>
                    )}
                  </div>
                  {result.snippet && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
                      {result.snippet}
                    </p>
                  )}
                </div>

                {/* Status */}
                {result.status && result.status !== "unknown" && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0 mt-1">
                    {result.status}
                  </span>
                )}
              </li>
            ))}
        </ul>

        {/* States: loading indicator shown via spinner above, empty, error, hint */}
        {showEmpty && (
          <div className="px-4 py-8 text-center text-sm text-gray-400" role="status">
            No results found for &ldquo;{debouncedQuery}&rdquo;
          </div>
        )}

        {error && (
          <div className="px-4 py-8 text-center text-sm text-red-500 dark:text-red-400" role="alert">
            {error}
          </div>
        )}

        {showHint && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            Type at least 2 characters to search
          </div>
        )}

        {/* Live region for screen readers — announces result count */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
          role="status"
        >
          {hasQuery && !loading && !error
            ? results.length > 0
              ? `${total} result${total !== 1 ? "s" : ""} found`
              : `No results found for ${debouncedQuery}`
            : ""}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-[11px] text-gray-400 dark:text-gray-500">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">↵</kbd>
            open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">esc</kbd>
            close
          </span>
          {hasQuery && !loading && total > 0 && (
            <span className="ms-auto">{total} result{total !== 1 ? "s" : ""}</span>
          )}
        </div>
      </div>
    </div>
  );
}
