import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getLibraryBooks } from "@/app/_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import Link from "next/link";
import { AddBookForm } from "./AddBookForm";
import { BooksTable } from "./BooksTable";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams?: { q?: string; status?: string };
}) {
  const search = searchParams?.q?.trim() || undefined;
  const status = searchParams?.status === "available" || searchParams?.status === "unavailable"
    ? searchParams.status
    : undefined;

  const { data: books, source } = await getLibraryBooks({ search, status });

  const totalTitles = books.length;
  const totalCopies = books.reduce((sum, b) => sum + b.copiesTotal, 0);
  const totalAvailable = books.reduce((sum, b) => sum + b.copiesAvailable, 0);
  const outOfStock = books.filter((b) => b.status === "unavailable").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Staff Library"
        subtitle="Catalogue of books held by the staff library, and copies currently available for issue."
        back="/estab"
        actions={
          <>
            {source === "error" && <DataSourceBadge source="error" />}
            <Link href="/estab/library/issues" className="btn ghost" style={{ minHeight: 44 }}>
              Issues &amp; loans
            </Link>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📚" iconBg="#e6f0ff" label="Titles" value={totalTitles.toLocaleString("en-IN")} />
        <StatCard icon="📦" iconBg="#eff6ff" label="Total Copies" value={totalCopies.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Copies Available" value={totalAvailable.toLocaleString("en-IN")} />
        <StatCard icon="🚫" iconBg="#fef2f2" label="Titles Out of Stock" value={outOfStock.toLocaleString("en-IN")} />
      </StatGrid>

      <AddBookForm />

      <Card title="Catalogue">
        {source === "error" && books.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : books.length === 0 ? (
          <EmptyState icon="📚" title="No books in the catalogue" message="Add a book above to start the catalogue." />
        ) : (
          <BooksTable rows={books} />
        )}
      </Card>
    </main>
  );
}
