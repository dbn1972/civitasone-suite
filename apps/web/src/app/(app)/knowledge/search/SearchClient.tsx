"use client";

import { useState, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { Button, DataTable, EmptyState, PageHeader, Segmented, StatusPill } from "../../../_components/ds";
import { knowledgeDocStatusLabel, knowledgeDocStatusPill } from "../_data/statusLabels";

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
  fullId: string;
  titleNode: ReactNode;
  category: string;
  statusNode: ReactNode;
  relevancePct: number;
  relevanceBar: ReactNode;
  isFile: boolean;
};

function relevanceScore(doc: Doc, query: string): number {
  const q = query.toLowerCase();
  let score = 0;
  if (doc.title.toLowerCase().includes(q)) score += 10;
  if (doc.category.toLowerCase().includes(q)) score += 5;
  if (doc.author?.toLowerCase().includes(q)) score += 3;
  if (doc.fileType?.toLowerCase().includes(q)) score += 2;
  if (doc.tags.some((t) => t.toLowerCase().includes(q))) score += 4;
  // GAP-KNOWLEDGE-SEARCH-05: down-weight archived documents
  if (doc.status === "archived") score = Math.round(score * 0.3);
  return score;
}

const RESULT_SEG_OPTIONS = ["All", "Documents", "Files"];

export function KnowledgeSearchClient({
  initialDocs,
  initialQuery = "",
}: {
  initialDocs: Doc[];
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery.length > 0);
  const [showFilters, setShowFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [resultSeg, setResultSeg] = useState("All");

  const categories = Array.from(new Set(initialDocs.map((d) => d.category).filter(Boolean))).sort();
  const statuses = Array.from(new Set(initialDocs.map((d) => d.status).filter(Boolean))).sort();

  const matchedDocs = submitted && query.trim()
    ? initialDocs
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
      id: doc.id.slice(0, 8).toUpperCase(),
      fullId: doc.id,
      titleNode: (
        <div>
          <Link href={`/knowledge/policies/${doc.id}`} style={{ fontWeight: 600, textDecoration: "underline" }}>
            {doc.title}
          </Link>
          <div style={{ fontSize: "12px", color: "var(--mut)" }}>{doc.author ?? ""}</div>
        </div>
      ),
      category: doc.category,
      // GAP-KNOWLEDGE-SEARCH-03: column renamed to Status, renders real status
      statusNode: (
        <StatusPill status={knowledgeDocStatusPill(doc.status)} label={knowledgeDocStatusLabel(doc.status)} />
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
      isFile: !!doc.fileType,
    };
  });

  // GAP-KNOWLEDGE-SEARCH-03: segment filter actually filters rows
  const segmentedRows = resultSeg === "All"
    ? resultRows
    : resultSeg === "Files"
      ? resultRows.filter((r) => r.isFile)
      : resultRows.filter((r) => !r.isFile);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (submitted) setSubmitted(false);
  }, [submitted]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") setSubmitted(true);
    if (e.key === "Escape") { setQuery(""); setSubmitted(false); }
  }, []);

  return (
    <div className="wrap">
      {/* GAP-KNOWLEDGE-SEARCH-01: honest subtitle */}
      <PageHeader
        title="Enterprise Search"
        subtitle="Search document titles, categories, authors and tags."
        actions={
          <Button
            variant="primary"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            aria-controls="advanced-filters"
          >
            Advanced filters
          </Button>
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
                  <option key={s} value={s}>{knowledgeDocStatusLabel(s)}</option>
                ))}
              </select>
            </div>
            {(categoryFilter || statusFilter) && (
              <Button variant="ghost" onClick={() => { setCategoryFilter(""); setStatusFilter(""); }}>
                Clear filters
              </Button>
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
                placeholder="Search document titles, categories, authors and tags…"
                autoComplete="off"
                aria-label="Search query"
              />
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
              {submitted && query && (
                <span className="chip" style={{ background: "var(--primary-soft)", color: "var(--primary-d)" }}>
                  Documents {segmentedRows.length}
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

      {submitted && query.trim() && segmentedRows.length === 0 && (
        <EmptyState
          icon="🔎"
          title="No documents found"
          message={`No results for "${query}". Try different keywords.`}
        />
      )}

      {segmentedRows.length > 0 && (
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
              { key: "titleNode", label: "Result", sortable: false, render: (row) => row.titleNode as ReactNode },
              { key: "category", label: "Type" },
              { key: "statusNode", label: "Status", sortable: false, render: (row) => row.statusNode as ReactNode },
              { key: "relevancePct", label: "Relevance", align: "right", render: (row) => row.relevanceBar as ReactNode },
            ]}
            rows={segmentedRows}
            sortable
            filterable
            pageSize={15}
          />
        </div>
      )}
    </div>
  );
}
