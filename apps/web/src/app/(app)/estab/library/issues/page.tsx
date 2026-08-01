import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getLibraryBooks, getLibraryIssues } from "@/app/_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { IssueBookForm } from "./IssueBookForm";
import { IssuesTable } from "./IssuesTable";

export default async function LibraryIssuesPage({
  searchParams,
}: {
  searchParams?: { bookId?: string };
}) {
  const [{ data: issues, source: issuesSource }, { data: books, source: booksSource }] = await Promise.all([
    getLibraryIssues(),
    getLibraryBooks(),
  ]);

  const overallSource = issuesSource === "error" || booksSource === "error" ? "error" : "api";
  const errored = overallSource === "error";

  const activeCount = issues.filter((i) => i.status === "issued").length;
  const overdueCount = issues.filter((i) => i.status === "overdue").length;
  const returnedCount = issues.filter((i) => i.status === "returned").length;

  const issuableBooks = books.filter((b) => b.copiesAvailable > 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Library Issues &amp; Loans"
        subtitle="Issue books to staff and record returns."
        back="/estab/library"
        actions={overallSource === "error" ? <DataSourceBadge source="error" /> : null}
      />

      {/* Counts below are computed from `issues`, which is [] whenever either
          loader errored — never render them as authoritative facts in that case. */}
      <StatGrid>
        <StatCard icon="📖" iconBg="#eff6ff" label="On Loan" value={errored ? "—" : activeCount.toLocaleString("en-IN")} />
        <StatCard icon="⏰" iconBg="#fef2f2" label="Overdue" value={errored ? "—" : overdueCount.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Returned" value={errored ? "—" : returnedCount.toLocaleString("en-IN")} />
      </StatGrid>

      <IssueBookForm books={issuableBooks} defaultBookId={searchParams?.bookId} />

      <Card title="Loans">
        {issuesSource === "error" && issues.length === 0 ? (
          <DataSourceBadge source="error" />
        ) : issues.length === 0 ? (
          <EmptyState icon="📖" title="No loans yet" message="Issued books will appear here." />
        ) : (
          <IssuesTable rows={issues} />
        )}
      </Card>
    </main>
  );
}
