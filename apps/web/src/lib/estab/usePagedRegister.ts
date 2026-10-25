"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";

const SEARCH_DEBOUNCE_MS = 350;

export type PagedRegister<T> = {
  rows: T[];
  /** Total rows matching the current search on the server. */
  total: number;
  loading: boolean;
  loadingMore: boolean;
  /** True when the first page failed to load (a retry is offered). */
  failed: boolean;
  /** Set when "Load more" failed; the rows already shown are kept. */
  moreError: unknown;
  searchInput: string;
  setSearchInput: (v: string) => void;
  /** The committed (debounced) search term the rows reflect. */
  query: string;
  hasMore: boolean;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
};

/**
 * A server-searched, server-paged register (estab inward and dispatch). The search term is
 * sent to the service as `q`, so an old entry is reachable past the first page; the service
 * returns `pagination.total`. GAP-ESTAB-DAK-04 / GAP-ESTAB-DISPATCH-04.
 */
export function usePagedRegister<T extends { id: string }>(path: string, pageSize = 50): PagedRegister<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  // CLOS3-S1-06: request tokens. A reply only applies while its token is still current; a new first-page
  // load, a query change, or unmount bumps both, so a slow loadMore for an old query cannot append rows.
  const loadSeq = useRef(0);
  const moreSeq = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  // Supersede every in-flight request (called from effect cleanup: new query/path or unmount).
  const invalidate = useCallback(() => {
    loadSeq.current++;
    moreSeq.current++;
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  const fetchPage = useCallback(async (offset: number, q: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (q) params.set("q", q);
    const res = await fetch(`${path}?${params.toString()}`, signal ? { signal } : undefined);
    if (!res.ok) throw await userFacingErrorFromResponse(res, "load");
    const body = (await res.json()) as { data?: T[]; pagination?: { total?: number } };
    const data = body.data ?? [];
    return { rows: data, total: typeof body.pagination?.total === "number" ? body.pagination.total : data.length };
  }, [path, pageSize]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const my = ++loadSeq.current;
    moreSeq.current++; // a fresh first page supersedes any in-flight loadMore
    setLoading(true);
    setFailed(false);
    setMoreError(null);
    setLoadingMore(false);
    try {
      const page = await fetchPage(0, query, signal);
      if (loadSeq.current !== my) return;
      setRows(page.rows);
      setTotal(page.total);
    } catch (e) {
      if (loadSeq.current !== my) return;
      if (e instanceof Error && e.name === "AbortError") return;
      setFailed(true);
    } finally {
      // CLOS3-S1-07: a superseded/aborted load must not clear the flag the newer load has set.
      if (loadSeq.current === my) setLoading(false);
    }
  }, [fetchPage, query]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      invalidate();
    };
  }, [load, invalidate]);

  const loadMore = useCallback(async () => {
    const my = ++moreSeq.current;
    const startedFor = query;
    const current = () => moreSeq.current === my && queryRef.current === startedFor;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await fetchPage(rows.length, query);
      if (!current()) return;
      setRows((cur) => {
        const seen = new Set(cur.map((r) => r.id));
        return [...cur, ...page.rows.filter((r) => !seen.has(r.id))];
      });
      setTotal(page.total);
    } catch (e) {
      if (!current()) return;
      setMoreError(e);
    } finally {
      if (moreSeq.current === my) setLoadingMore(false);
    }
  }, [fetchPage, query, rows.length]);

  return {
    rows, total, loading, loadingMore, failed, moreError, searchInput, setSearchInput, query,
    hasMore: rows.length < total,
    reload: () => load(),
    loadMore,
  };
}
