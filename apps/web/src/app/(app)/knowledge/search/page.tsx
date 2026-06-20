"use client";

import { useState } from "react";
import Link from "next/link";

type SearchResult = {
  id: string;
  title: string;
  category: string;
  excerpt?: string;
  relevanceScore?: number;
  documentType?: string;
  createdAt: string;
};

export default function KnowledgeSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const res = await fetch("/api/proxy/v1/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : (data.results ?? []));
    } catch {
      setError("Search service is unavailable. Please try again.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-6">
        <nav className="text-sm text-slate-500 mb-1">
          <Link href="/knowledge" className="hover:underline">Knowledge</Link>
          {" / "}Search
        </nav>
        <h1 className="text-2xl font-semibold text-slate-900">Knowledge Search</h1>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents, records, policies…"
          className="flex-1 border border-slate-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {!searched && !loading && (
        <div className="text-center py-16 text-slate-400">
          <div className="text-4xl mb-3">🔍</div>
          <p>Enter keywords to search the knowledge repository</p>
        </div>
      )}

      {searched && !loading && results.length === 0 && !error && (
        <div className="text-center py-12 text-slate-400">
          No documents found matching your search.
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            {results.length} result{results.length !== 1 ? "s" : ""} found
          </p>
          {results.map((r) => (
            <div
              key={r.id}
              className="bg-white border border-slate-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium text-slate-900">{r.title}</h3>
                {r.relevanceScore !== undefined && (
                  <span className="text-xs text-slate-400 shrink-0">
                    Score: {(r.relevanceScore * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="flex gap-2 mt-1 flex-wrap">
                <span className="text-xs text-blue-600">{r.category}</span>
                {r.documentType && (
                  <span className="text-xs text-slate-400">· {r.documentType}</span>
                )}
                <span className="text-xs text-slate-400">· {r.createdAt}</span>
              </div>
              {r.excerpt && (
                <p className="text-sm text-slate-600 mt-2">{r.excerpt}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
