"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { chapterNumber, type Chapter } from "./chapters";

/**
 * Client-side filter + grid for the docs home (GAP-DOCS-HOME-02).
 * Filters chapters by title/description as the user types; an empty query
 * shows every chapter. Numbering uses each chapter's stable `number` field
 * rather than the array index (GAP-DOCS-HOME-03).
 */
export function DocsChapterGrid({ chapters }: { chapters: Chapter[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return chapters;
    return chapters.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }, [chapters, query]);

  return (
    <div className="mt-10">
      <div className="max-w-md">
        <label htmlFor="docs-search" className="sr-only">
          Search documentation
        </label>
        <input
          id="docs-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chapters (e.g. leave, budget, GST)"
          className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
          aria-describedby="docs-search-count"
        />
      </div>

      <p id="docs-search-count" role="status" aria-live="polite" className="mt-2 text-sm text-gray-500">
        {filtered.length === chapters.length
          ? `${chapters.length} chapters`
          : `${filtered.length} of ${chapters.length} chapters`}
      </p>

      {filtered.length === 0 ? (
        <p className="mt-8 text-sm text-gray-500">
          No chapters match “{query}”. Try a different term.
        </p>
      ) : (
        <div data-testid="docs-chapter-grid" className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((chapter) => {
            const n = chapterNumber(chapter);
            return (
              <Link
                key={chapter.slug}
                href={`/docs/${chapter.slug}`}
                className="group rounded-xl border border-gray-200 p-6 hover:border-gray-300 hover:shadow-md transition-all"
              >
                <div className="text-3xl">{chapter.icon}</div>
                <h2 className="mt-3 text-lg font-semibold text-gray-900 group-hover:text-gray-700">
                  {n === undefined ? chapter.title : `${n}. ${chapter.title}`}
                </h2>
                <p className="mt-2 text-sm text-gray-500">{chapter.description}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
