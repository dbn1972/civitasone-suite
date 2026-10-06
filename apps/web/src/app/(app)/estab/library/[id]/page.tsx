import { getLibraryBookById } from "@/app/_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, StatusPill, RefreshErrorState, EmptyState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole, ESTAB_LIBRARY_WRITE_ROLES } from "@/lib/auth/roleGuard";
import { EditBookForm } from "./EditBookForm";
import { CurrentLoansCard } from "./CurrentLoansCard";
import Link from "next/link";

export default async function LibraryBookDetailPage({ params }: { params: { id: string } }) {
  const { data: book, source, status } = await getLibraryBookById(params.id);

  if (!book) {
    // GAP-ESTAB-LIBRARY-DETAIL-03: a genuine 404 ("the book does not exist")
    // is distinct from a transient failure. The loader now surfaces the HTTP
    // status, so a 404 gets an EmptyState with a way back to the catalogue,
    // and every other error (5xx / network) gets a retryable error state.
    if (source === "error" && status !== 404) {
      return (
        <div className="page-main wrap" aria-labelledby="page-heading">
          <PageHeader title="Book" back="/estab/library" />
          <RefreshErrorState error={toHumanError("load", { area: "book" })} backHref="/estab/library" />
        </div>
      );
    }
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Book not found" back="/estab/library" />
        <EmptyState
          icon="📚"
          title="Book not found"
          message="This book is not in the catalogue. It may have been withdrawn."
          action={
            <Link href="/estab/library" className="btn primary" style={{ minHeight: 44 }}>
              Back to catalogue
            </Link>
          }
        />
      </div>
    );
  }

  const canManage = hasAnyRole(getSessionRoles(), ESTAB_LIBRARY_WRITE_ROLES);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={book.title}
        subtitle={book.author ? `by ${book.author}` : undefined}
        back="/estab/library"
        actions={
          <StatusPill status={book.status} label={book.status === "withdrawn" ? "Withdrawn" : book.status === "available" ? "Available" : "Out of stock"} variant={book.status === "available" ? "good" : "bad"} />
        }
      />

      <StatGrid>
        <StatCard icon="📦" iconBg="#eff6ff" label="Total Copies" value={book.copiesTotal.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Copies Available" value={book.copiesAvailable.toLocaleString("en-IN")} />
        <StatCard icon="📖" iconBg="#fffaeb" label="Copies Out" value={(book.copiesTotal - book.copiesAvailable).toLocaleString("en-IN")} />
      </StatGrid>

      <Card title="Book details" padding>
        {/* GAP-ESTAB-LIBRARY-DETAIL-04: use the shared .fld/.l/.v detail-list
            classes (same as estab/files/[id]) instead of a hand-rolled,
            inline-styled <dl>. */}
        <div className="fields" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <div className="fld"><div className="l">Accession No.</div><div className="v">{book.accessionNo}</div></div>
          <div className="fld"><div className="l">Author</div><div className="v">{book.author ?? "—"}</div></div>
          <div className="fld"><div className="l">ISBN</div><div className="v">{book.isbn ?? "—"}</div></div>
          <div className="fld"><div className="l">Category</div><div className="v">{book.category ?? "—"}</div></div>
        </div>
      </Card>

      {/* GAP-ESTAB-LIBRARY-DETAIL-02: show who holds the copies out (PII
          — visible only to librarian/admin roles) */}
      {canManage && (book.copiesTotal - book.copiesAvailable) > 0 && (
        <CurrentLoansCard bookId={book.id} />
      )}

      <p style={{ marginTop: 16 }}>
        {book.copiesAvailable > 0 && book.status !== "withdrawn" ? (
          <Link href={`/estab/library/issues?bookId=${encodeURIComponent(book.id)}`} className="btn primary" style={{ minHeight: 44 }}>
            Issue this book
          </Link>
        ) : book.status === "withdrawn" ? (
          <span className="sub">This book has been withdrawn.</span>
        ) : (
          <span className="sub">No copies currently available to issue.</span>
        )}
      </p>

      {canManage && <EditBookForm book={book} />}
    </div>
  );
}
