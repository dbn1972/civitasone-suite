import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getLibraryBooks } from "@/app/_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole, ESTAB_LIBRARY_WRITE_ROLES } from "@/lib/auth/roleGuard";
import Link from "next/link";
import { AddBookForm } from "./AddBookForm";
import { BooksTable } from "./BooksTable";

export default async function LibraryPage() {
  // GAP-ESTAB-LIBRARY-02: this page always loads the full catalogue. The header
  // stats ("Titles", "Total Copies", …) describe the whole catalogue, so we
  // must not server-filter by ?q=/?status= — the BooksTable segment/filter
  // narrows the view client-side without changing those whole-catalogue stats.
  const { data: books, source } = await getLibraryBooks();
  const errored = source === "error";

  // GAP-ESTAB-LIBRARY-05: only librarians (estab_officer/admin/super_admin) may
  // add books; the server already 403s others on POST /v1/estab/library/books,
  // so we hide the control rather than offer a guaranteed failure.
  const canAddBook = hasAnyRole(getSessionRoles(), ESTAB_LIBRARY_WRITE_ROLES);
  const existingAccessions = books.map((b) => b.accessionNo);

  const totalTitles = books.length;
  const totalCopies = books.reduce((sum, b) => sum + b.copiesTotal, 0);
  const totalAvailable = books.reduce((sum, b) => sum + b.copiesAvailable, 0);
  const outOfStock = books.filter((b) => b.status === "unavailable").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
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

      {/* Counts below are computed from `books`, which is [] whenever the fetch
          errored — never render them as authoritative facts in that case. */}
      <StatGrid>
        <StatCard icon="📚" iconBg="#e6f0ff" label="Titles" value={errored ? "—" : totalTitles.toLocaleString("en-IN")} />
        <StatCard icon="📦" iconBg="#eff6ff" label="Total Copies" value={errored ? "—" : totalCopies.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Copies Available" value={errored ? "—" : totalAvailable.toLocaleString("en-IN")} />
        <StatCard icon="🚫" iconBg="#fef2f2" label="Titles Out of Stock" value={errored ? "—" : outOfStock.toLocaleString("en-IN")} />
      </StatGrid>

      {/* GAP-ESTAB-LIBRARY-01: while the catalogue failed to load we cannot
          validate accession numbers against the (unloaded) catalogue, so the
          add form is hidden to prevent duplicate-accession adds.
          GAP-ESTAB-LIBRARY-05: non-librarians never see the add form. */}
      {errored || !canAddBook ? null : <AddBookForm existingAccessions={existingAccessions} />}

      <Card title="Catalogue">
        {errored && books.length === 0 ? (
          <RefreshErrorState error={toHumanError("load", { area: "catalogue" })} backHref="/estab" />
        ) : books.length === 0 ? (
          <EmptyState icon="📚" title="No books in the catalogue" message="Add a book above to start the catalogue." />
        ) : (
          <BooksTable rows={books} />
        )}
      </Card>
    </div>
  );
}
