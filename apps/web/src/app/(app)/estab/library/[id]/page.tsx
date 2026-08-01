import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getLibraryBookById } from "@/app/_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, StatusPill } from "@/app/_components/ds";
import Link from "next/link";

export default async function LibraryBookDetailPage({ params }: { params: { id: string } }) {
  const { data: book, source } = await getLibraryBookById(params.id);

  if (!book) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Book not found" back="/estab/library" />
        {source === "error" ? (
          <DataSourceBadge source="error" />
        ) : (
          <p className="sub">The requested book could not be found in the catalogue.</p>
        )}
      </main>
    );
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={book.title}
        subtitle={book.author ? `by ${book.author}` : undefined}
        back="/estab/library"
        actions={
          <>
            {source === "error" && <DataSourceBadge source="error" />}
            <StatusPill status={book.status} label={book.status === "available" ? "Available" : "Unavailable"} />
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📦" iconBg="#eff6ff" label="Total Copies" value={book.copiesTotal.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Copies Available" value={book.copiesAvailable.toLocaleString("en-IN")} />
        <StatCard icon="📖" iconBg="#fffaeb" label="Copies Out" value={(book.copiesTotal - book.copiesAvailable).toLocaleString("en-IN")} />
      </StatGrid>

      <Card title="Book details" padding>
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, margin: 0 }}>
          <div>
            <dt style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>Accession No.</dt>
            <dd style={{ margin: 0 }}>{book.accessionNo}</dd>
          </div>
          <div>
            <dt style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>Author</dt>
            <dd style={{ margin: 0 }}>{book.author ?? "—"}</dd>
          </div>
          <div>
            <dt style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>ISBN</dt>
            <dd style={{ margin: 0 }}>{book.isbn ?? "—"}</dd>
          </div>
          <div>
            <dt style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>Category</dt>
            <dd style={{ margin: 0 }}>{book.category ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      <p style={{ marginTop: 16 }}>
        {book.copiesAvailable > 0 ? (
          <Link href={`/estab/library/issues?bookId=${encodeURIComponent(book.id)}`} className="btn primary" style={{ minHeight: 44 }}>
            Issue this book
          </Link>
        ) : (
          <span className="sub">No copies currently available to issue.</span>
        )}
      </p>
    </main>
  );
}
