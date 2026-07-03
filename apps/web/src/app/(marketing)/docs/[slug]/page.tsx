import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { chapters } from "../_content/chapters";
import { MarkdownContent } from "../_content/markdown";

interface Props {
  params: { slug: string };
}

export function generateStaticParams() {
  return chapters.map((ch) => ({ slug: ch.slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const chapter = chapters.find((ch) => ch.slug === params.slug);
  if (!chapter) return {};
  return {
    title: `${chapter.title} — CivitasOne Docs`,
    description: chapter.description,
  };
}

export default function ChapterPage({ params }: Props) {
  const index = chapters.findIndex((ch) => ch.slug === params.slug);
  if (index === -1) notFound();

  const chapter = chapters[index]!;
  const prev = index > 0 ? chapters[index - 1]! : null;
  const next = index < chapters.length - 1 ? chapters[index + 1]! : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-10">
        {/* Left sidebar */}
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1">
            <Link
              href="/docs"
              className="mb-4 block text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600"
            >
              ← All Chapters
            </Link>
            {chapters.map((ch, i) => (
              <Link
                key={ch.slug}
                href={`/docs/${ch.slug}`}
                className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                  ch.slug === params.slug
                    ? "bg-gray-100 font-medium text-gray-900"
                    : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                }`}
              >
                {ch.icon} {i + 1}. {ch.title}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="min-w-0">
          {/* Top bar with PDF download */}
          <div className="mb-8 flex items-center justify-between">
            <Link
              href="/docs"
              className="text-sm text-gray-500 hover:text-gray-700 lg:hidden"
            >
              ← All Chapters
            </Link>
            <a
              href="/docs/CivitasOne-User-Manual.pdf"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
              download
            >
              📄 Download PDF
            </a>
          </div>

          {/* Markdown content */}
          <article className="mx-auto max-w-[720px]" style={{ lineHeight: "1.75", fontFamily: "system-ui, -apple-system, sans-serif" }}>
            <MarkdownContent content={chapter.content} />
          </article>

          {/* Prev/Next navigation */}
          <nav className="mx-auto mt-16 flex max-w-[720px] items-center justify-between border-t border-gray-200 pt-8">
            {prev ? (
              <Link
                href={`/docs/${prev.slug}`}
                className="group flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
              >
                <span>←</span>
                <span>
                  <span className="block text-xs text-gray-400">Previous</span>
                  <span className="font-medium group-hover:underline">{prev.title}</span>
                </span>
              </Link>
            ) : <div />}
            {next ? (
              <Link
                href={`/docs/${next.slug}`}
                className="group flex items-center gap-2 text-right text-sm text-gray-500 hover:text-gray-900"
              >
                <span>
                  <span className="block text-xs text-gray-400">Next</span>
                  <span className="font-medium group-hover:underline">{next.title}</span>
                </span>
                <span>→</span>
              </Link>
            ) : <div />}
          </nav>
        </main>
      </div>
    </div>
  );
}
