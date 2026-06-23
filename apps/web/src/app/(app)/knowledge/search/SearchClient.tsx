"use client";

import { useState, useCallback } from "react";
import { PageHeader, StatusPill } from "../../../_components/ds";

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

export function KnowledgeSearchClient({ initialDocs }: { initialDocs: Doc[] }) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const results = submitted && query.trim()
    ? initialDocs
        .map((doc) => ({ doc, score: relevanceScore(doc, query.trim()) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.doc)
    : [];

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
      <PageHeader
        title="Enterprise Search"
        subtitle={`Full-text + metadata search across all documents & modules.`}
        actions={<button className="btn primary">Advanced filters</button>}
      />

      <div className="card" style={{ marginBottom: "18px" }}>
        <div className="pad">
          <form onSubmit={handleSubmit} role="search">
            <div className="tb-search" style={{ maxWidth: "none", fontSize: "15px", padding: "14px 16px" }}>
              🔎
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
                  Documents {results.length}
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
        <div className="empty-state">
          <div className="ic">🔎</div>
          <h4>Search the knowledge repository</h4>
          <p>Enter keywords or click a suggestion above</p>
        </div>
      )}

      {submitted && query.trim() && results.length === 0 && (
        <div className="empty-state">
          <div className="ic">🔎</div>
          <h4>No documents found</h4>
          <p>No results for &ldquo;{query}&rdquo;. Try different keywords.</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="card">
          <div className="card-h">
            <h3>Results · &ldquo;{query}&rdquo;</h3>
            <div className="seg"><span className="on">All</span><span>Documents</span><span>Files</span></div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Result</th>
                <th>Type</th>
                <th>Source module</th>
                <th>Relevance</th>
              </tr>
            </thead>
            <tbody>
              {results.map((doc) => {
                const score = relevanceScore(doc, query.trim());
                const maxScore = 24;
                const pct = Math.min(100, Math.round((score / maxScore) * 100));
                return (
                  <tr key={doc.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{doc.title}</div>
                      <div style={{ fontSize: "12px", color: "#98a2b3" }}>{doc.author ?? ""}</div>
                    </td>
                    <td>{doc.category}</td>
                    <td>
                      <StatusPill status={statusPillStatus(doc.status)} label={statusLabel(doc.status)} />
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div className="bar" style={{ width: "70px" }}>
                          <i style={{ width: `${pct}%`, background: "#ca8a04" }}></i>
                        </div>
                        <span style={{ fontSize: "12px", fontWeight: 600 }}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
