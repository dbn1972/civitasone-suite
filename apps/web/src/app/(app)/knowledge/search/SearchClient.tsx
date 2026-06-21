"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

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

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitted(true);
    },
    []
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    if (submitted) setSubmitted(false);
  }, [submitted]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      setSubmitted(true);
    }
    if (e.key === "Escape") {
      setQuery("");
      setSubmitted(false);
    }
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-4xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/knowledge" className="hover:text-slate-900">Knowledge</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Enterprise Search</span>
        </nav>

        <header>
          <h1 className="text-3xl font-semibold text-slate-900">Enterprise Search</h1>
          <p className="mt-1 text-sm text-slate-600">
            Full-text search across {initialDocs.length.toLocaleString("en-IN")} documents, circulars &amp; records.
          </p>
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <form onSubmit={handleSubmit} role="search" aria-label="Search documents">
            <div className="flex gap-2">
              <label htmlFor="knowledge-search" className="sr-only">
                Search circulars, policies, files, records
              </label>
              <input
                id="knowledge-search"
                type="search"
                value={query}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Search circulars, policies, files, records across CivitasOne…"
                autoComplete="off"
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Search query"
              />
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                Search
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Quick search suggestions">
              {["travel policy", "GFR 2017", "recruitment", "procurement"].map((term) => (
                <button
                  key={term}
                  type="button"
                  onClick={() => { setQuery(term); setSubmitted(true); }}
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  {term}
                </button>
              ))}
            </div>
          </form>
        </section>

        {!submitted && (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
            <p className="text-slate-400 text-lg mb-1">Search the knowledge repository</p>
            <p className="text-sm text-slate-400">Enter keywords or click a suggestion above (press Enter or Escape to clear)</p>
          </div>
        )}

        {submitted && query.trim() && results.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
            <p className="text-slate-500 font-medium">No documents found</p>
            <p className="text-sm text-slate-400 mt-1">
              No results for &ldquo;{query}&rdquo;. Try different keywords.
            </p>
          </div>
        )}

        {results.length > 0 && (
          <section aria-label={`Search results for "${query}"`}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-slate-600">
                <span className="font-medium">{results.length.toLocaleString("en-IN")}</span>{" "}
                result{results.length !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
              <table aria-label="Search results" className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th scope="col" className="px-4 py-3">Result</th>
                    <th scope="col" className="px-4 py-3">Category</th>
                    <th scope="col" className="px-4 py-3">Author</th>
                    <th scope="col" className="px-4 py-3">Access</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3">Relevance</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((doc) => {
                    const score = relevanceScore(doc, query.trim());
                    const maxScore = 24;
                    const pct = Math.min(100, Math.round((score / maxScore) * 100));
                    return (
                      <tr key={doc.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900 max-w-xs truncate" title={doc.title}>
                          {doc.title}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{doc.category}</td>
                        <td className="px-4 py-3 text-slate-600">{doc.author ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                            {doc.accessLevel}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                            doc.status === "approved" ? "bg-emerald-50 text-emerald-700" :
                            doc.status === "under_review" ? "bg-amber-50 text-amber-700" :
                            "bg-slate-100 text-slate-600"
                          }`}>
                            {doc.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-16 rounded bg-slate-100 h-2"
                              role="progressbar"
                              aria-valuenow={pct}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`Relevance: ${pct}%`}
                            >
                              <div className="h-2 rounded bg-amber-500" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs font-semibold text-slate-600">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
