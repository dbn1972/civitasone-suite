import Link from "next/link";
import type { Metadata } from "next";
import { chapters } from "./_content/chapters";

export const metadata: Metadata = {
  title: "Documentation — CivitasOne",
  description: "Complete step-by-step guide for every module in CivitasOne.",
};

export default function DocsPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
            Documentation
          </h1>
          <p className="mt-2 text-lg text-gray-500">
            Complete step-by-step guide for every module
          </p>
        </div>
        <a
          href="/docs/CivitasOne-User-Manual.pdf"
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          download
        >
          <span>📄</span> Download as PDF
        </a>
      </div>

      {/* Chapter grid */}
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {chapters.map((chapter, i) => (
          <Link
            key={chapter.slug}
            href={`/docs/${chapter.slug}`}
            className="group rounded-xl border border-gray-200 p-6 hover:border-gray-300 hover:shadow-md transition-all"
          >
            <div className="text-3xl">{chapter.icon}</div>
            <h2 className="mt-3 text-lg font-semibold text-gray-900 group-hover:text-gray-700">
              {i + 1}. {chapter.title}
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              {chapter.description}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
