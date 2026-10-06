import type { Metadata } from "next";
import { chapters } from "./_content/chapters";
import { DocsChapterGrid } from "./_content/DocsChapterGrid";

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
      </div>

      {/* Searchable chapter grid */}
      <DocsChapterGrid chapters={chapters} />
    </section>
  );
}
