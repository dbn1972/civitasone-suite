"use client";

import { useState, useMemo } from "react";
import { EmptyState } from "@/app/_components/ds";

type FaqItem = {
  id: string;
  question: string;
  answer: string;
  category: string;
  tags: string[];
  status: string;
  updatedAt: string;
};

/**
 * GAP-KNOWLEDGE-FAQS-03: client-side FAQ browser with search + category filter.
 * Filters on question, answer and tags; derives categories from the data.
 */
export function FaqBrowser({ faqs }: { faqs: FaqItem[] }) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");

  const categories = useMemo(
    () => Array.from(new Set(faqs.map((f) => f.category))).sort(),
    [faqs],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return faqs.filter((f) => {
      if (catFilter && f.category !== catFilter) return false;
      if (!q) return true;
      return (
        f.question.toLowerCase().includes(q) ||
        f.answer.toLowerCase().includes(q) ||
        f.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [faqs, search, catFilter]);

  return (
    <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search FAQs…"
          aria-label="Search FAQs"
          className="inp"
          style={{ flex: "1 1 240px", minHeight: 40 }}
        />
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          aria-label="Filter by category"
          className="inp"
          style={{ minHeight: 40, minWidth: 160 }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {(search || catFilter) && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => { setSearch(""); setCatFilter(""); }}
            style={{ minHeight: 40 }}
          >
            Clear
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="❓" title="No FAQs match" message="Try different keywords or clear the filters." />
      ) : (
        filtered.map((f) => (
          <details key={f.id} style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 10, padding: "12px 14px" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--ink, #0f172a)" }}>
              {f.question}
              {/* GAP-KNOWLEDGE-FAQS-05: always show category label, including "General" */}
              <span style={{ marginLeft: 8, fontSize: 12, color: "var(--mut)" }}>· {f.category}</span>
            </summary>
            <p style={{ marginTop: 8, marginBottom: 0, lineHeight: 1.6, color: "var(--ink2, #475569)", whiteSpace: "pre-wrap" }}>{f.answer}</p>
          </details>
        ))
      )}
    </div>
  );
}
