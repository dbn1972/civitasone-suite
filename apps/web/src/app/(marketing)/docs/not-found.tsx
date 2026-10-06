import Link from "next/link";
import { chapters, chapterNumber } from "./_content/chapters";

/**
 * Docs-specific not-found page (GAP-DOCS-SLUG-04). Shown for unknown docs
 * slugs instead of the generic app 404, with a direct link back to the docs
 * home and the full chapter list so the reader can recover in one tap.
 */
export default function DocsNotFound() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
      <p className="text-sm font-semibold uppercase tracking-wider text-gray-400">
        404 — Documentation
      </p>
      <h1 className="mt-2 text-3xl font-bold text-gray-900">
        That documentation page was not found
      </h1>
      <p className="mt-3 text-gray-500">
        The chapter you were looking for does not exist or may have moved. Head
        back to the documentation home or pick a chapter below.
      </p>

      <div className="mt-6">
        <Link
          href="/docs"
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
        >
          ← Back to Documentation
        </Link>
      </div>

      <nav aria-label="All chapters" className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
          All chapters
        </h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {chapters.map((ch) => {
            const n = chapterNumber(ch);
            return (
              <li key={ch.slug}>
                <Link
                  href={`/docs/${ch.slug}`}
                  className="block rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                >
                  {ch.icon} {n === undefined ? ch.title : `${n}. ${ch.title}`}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </section>
  );
}
