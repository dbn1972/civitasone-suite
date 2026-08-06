"use client";

import { useState, useCallback, type ReactNode } from "react";
import { DataTable, EmptyState, PageHeader, Segmented, StatusPill } from "../../../_components/ds";

type Doc = {
  id: string;
  title: string;
  category: string;
  author?: string | null;
  createdAt: string;
  tags: string[];
  status: string;
  accessLevel: string;
  version: string;
  fileType?: string | null;
};

type ResultRow = {
  id: string;
  titleNode: ReactNode;
  category: string;
  sourceModule: ReactNode;
  relevancePct: number;
  relevanceBar: ReactNode;
};

function relevanceScore(doc: Doc, query: string): number {
  const q = query.toLowerCase();
  let score = 0;
  if (doc.title.toLowerCase().includes(q)) score += 10;
  if (doc.category.toLowerCase().includes(q)) score += 5;
  if (doc.author?.toLowerCase().includes(q)) score += 3;
  if (doc.fileType?.toLowerCase().includes(q)) score += 2;
  if (doc.tags.some((t) => t.toLowerCase().includes(q))) score += 4;
  return score;
}

function statusPillStatus(s: string) {
  if (s === "approved") return "approved";
  if (s === "under_review") return "pending";
  return "mut";
}

function statusLabel(s: string) {
  if (s === "approved") return "Published";
  if (s === "under_review") return "Under review";
  if (s === "draft") return "Draft";
  return s;
}

const RESULT_SEG_OPTIONS = ["All", "Documents", "Files"];

/** A hit from the real server index (GET /v1/knowledge/search). */
type ServerHit = {
  id: string;
  documentId?: string;
  title: string;
  tags?: string[];
  score?: number;
};

export function KnowledgeSearchClient({ initialDocs }: { initialDocs: Doc[] }) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);
  // null → server index unavailable, fall back to client-side metadata scoring.
  const [serverHits, setServerHits] = useState<ServerHit[] | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [resultSeg, setResultSeg] = useState("All");

  const categories = Array.from(new Set(initialDocs.map((d) => d.category).filter(Boolean))).sort();
  const statuses = Array.from(new Set(initialDocs.map((d) => d.status).filter(Boolean))).sort();

  // Server results are authoritative (full-text over CONTENT, which client
  // metadata scoring can never see); local docs supply display metadata, and
  // client scoring remains only as the degraded fallback.
  const docById = new Map(initialDocs.map((d) => [d.id, d]));
  const matchedDocs = submitted && query.trim()
    ? serverHits
      ? serverHits
          .map((h) => docById.get(h.documentId ?? h.id) ?? ({
            id: h.documentId ?? h.id,
            title: h.title,
            category: "",
            createdAt: "",
            tags: h.tags ?? [],
            status: "approved",
            accessLevel: "",
            version: "",
          } as Doc))
          .filter((doc) => (categoryFilter ? doc.category === categoryFilter : true))
          .filter((doc) => (statusFilter ? doc.status === statusFilter : true))
      : initialDocs
          .filter((doc) => (categoryFilter ? doc.category === categoryFilter : true))
          .filter((doc) => (statusFilter ? doc.status === statusFilter : true))
          .map((doc) => ({ doc, score: relevanceScore(doc, query.trim()) }))
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((r) => r.doc)
    : [];

  const maxScore = 24;

  const resultRows: ResultRow[] = matchedDocs.map((doc) => {
    const score = relevanceScore(doc, query.trim());
    const pct = Math.min(100, Math.round((score / maxScore) * 100));
    return {
      id: doc.id,
      titleNode: (
        <div>
          <div style={{ fontWeight: 600 }}>{doc.title}</div>
          <div style={{ fontSize: "12px", color: "#98a2b3" }}>{doc.author ?? ""}</div>
        </div>
      ),
      category: doc.category,
      sourceModule: (
        <StatusPill status={statusPillStatus(doc.status)} label={statusLabel(doc.status)} />
      ),
      relevancePct: pct,
      relevanceBar: (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div className="bar" style={{ width: "70px" }}>
            <i style={{ width: `${pct}%`, background: "#ca8a04" }}></i>
          </div>
          <span style={{ fontSize: "12px", fontWeight: 600 }}>{pct}%</span>
        </div>
      ),
    };
  });

  const runSearch = useCallback(async () => {
    setSubmitted(true);
    const q = query.trim();
    if (!q) return;
    try {
      const params = new URLSearchParams({ q, limit: "50" });
      if (categoryFilter) params.set("category", categoryFilter);
      const res = await fetch(`/api/proxy/v1/knowledge/search?${params.toString()}`);
      if (res.ok) {
        const json: unknown = await res.json();
        const hits = Array.isArray(json)
          ? json
          : ((json as { hits?: unknown[]; data?: unknown[] })?.hits ??
             (json as { data?: unknown[] })?.data ?? []);
        setServerHits(hits as ServerHit[]);
        return;
      }
    } catch {
      /* index unreachable — degrade below */
    }
    setServerHits(null);
  }, [query, categoryFilter]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    void runSearch();
  }, [runSearch]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (submitted) { setSubmitted(false); setServerHits(null); }
  }, [submitted]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void runSearch();
    if (e.key === "Escape") { setQuery(""); setSubmitted(false); setServerHits(null); }
  }, [runSearch]);

  return (
    <div className="wrap">
      <PageHeader
        title="Enterprise Search"
        subtitle={`Full-text + metadata search across all documents & modules.`}
        actions={
          <button
            type="button"
            className="btn primary"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            aria-controls="advanced-filters"
          >
            Advanced filters
          </button>
        }
      />

      {showFilters && (
        <div id="advanced-filters" className="card" style={{ marginBottom: "18px" }}>
          <div className="card-h"><h3>Advanced filters</h3></div>
          <div className="pad" style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label className="label" htmlFor="filter-category">Category</label>
              <select id="filter-category" className="inp" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ minHeight: 40 }}>
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label className="label" htmlFor="filter-status">Status</label>
              <select id="filter-status" className="inp" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ minHeight: 40 }}>
                <option value="">Any status</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>{statusLabel(s)}</option>
                ))}
              </select>
            </div>
            {(categoryFilter || statusFilter) && (
              <button type="button" className="btn ghost" onClick={() => { setCategoryFilter(""); setStatusFilter(""); }}>
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: "18px" }}>
        <div className="pad">
          <form onSubmit={handleSubmit} role="search">
            <div className="tb-search" style={{ maxWidth: "none", fontSize: "15px", padding: "14px 16px" }}>
              <span aria-hidden="true">🔎</span>
              <input
                type="search"
                value={query}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Search circulars, policies, files, records across CivitasOne…"
                autoComplete="off"
                aria-label="Search query"
              />
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
              {submitted && query && (
                <span className="chip" style={{ background: "var(--primary-soft)", color: "var(--primary-d)" }}>
                  Documents {resultRows.length}
                </span>
              )}
              {["travel policy", "GFR 2017", "recruitment", "procurement"].map((term) => (
                <button
                  key={term}
                  type="button"
                  className="chip"
                  style={{ cursor: "pointer", border: "none", background: undefined }}
                  onClick={() => { setQuery(term); setSubmitted(true); }}
                >
                  {term}
                </button>
              ))}
            </div>
          </form>
        </div>
      </div>

      {!submitted && (
        <EmptyState
          icon="🔎"
          title="Search the knowledge repository"
          message="Enter keywords or click a suggestion above"
        />
      )}

      {submitted && query.trim() && resultRows.length === 0 && (
        <EmptyState
          icon="🔎"
          title="No documents found"
          message={`No results for "${query}". Try different keywords.`}
        />
      )}

      {resultRows.length > 0 && (
        <div className="card">
          <div className="card-h">
            <h3>Results · &ldquo;{query}&rdquo;</h3>
            <Segmented
              options={RESULT_SEG_OPTIONS}
              value={resultSeg}
              onChange={setResultSeg}
            />
          </div>
          <DataTable<ResultRow>
            columns={[
              { key: "titleNode", label: "Result", sortable: false },
              { key: "category", label: "Type" },
              { key: "sourceModule", label: "Source module", sortable: false },
              { key: "relevancePct", label: "Relevance", align: "right", render: (row) => row.relevanceBar as ReactNode },
            ]}
            rows={resultRows}
            sortable
            filterable
            pageSize={15}
          />
        </div>
      )}
    </div>
  );
}
