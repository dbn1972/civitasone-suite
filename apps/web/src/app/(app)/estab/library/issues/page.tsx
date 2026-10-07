import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getLibraryBooks, getLibraryIssues } from "@/app/_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
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

  // GAP-ESTAB-LIBRARY-ISSUES-05: gate the loan stats on the ISSUES loader
  // alone — a catalogue (books) failure must not blank valid loan counts.
  const issuesErrored = issuesSource === "error";
  const booksErrored = booksSource === "error";

  // GAP-ESTAB-LIBRARY-ISSUES-02: a book that is overdue is still physically on
  // loan, so "On Loan" counts issued + overdue; "Overdue" remains a subset.
  const issuedCount = issues.filter((i) => i.status === "issued").length;
  const overdueCount = issues.filter((i) => i.status === "overdue").length;
  const activeCount = issuedCount + overdueCount;
  const returnedCount = issues.filter((i) => i.status === "returned").length;

  const issuableBooks = books.filter((b) => b.copiesAvailable > 0);

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Library Issues &amp; Loans"
        subtitle="Issue books to staff and record returns."
        back="/estab/library"
        actions={issuesErrored || booksErrored ? <DataSourceBadge source="error" /> : null}
      />

      {/* GAP-ESTAB-LIBRARY-ISSUES-05: loan stats depend only on the issues
          loader; a catalogue failure affects the form card, not these counts. */}
      <StatGrid>
        <StatCard icon="📖" iconBg="#eff6ff" label="On Loan" value={issuesErrored ? "—" : activeCount.toLocaleString("en-IN")} />
        <StatCard icon="⏰" iconBg="#fef2f2" label="Overdue" value={issuesErrored ? "—" : overdueCount.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Returned" value={issuesErrored ? "—" : returnedCount.toLocaleString("en-IN")} />
      </StatGrid>

      {booksErrored ? (
        // The catalogue failed to load — do NOT let the form claim "no copies
        // are available to issue", which is a different (false) statement.
        <Card title="Issue a book">
          <RefreshErrorState error={toHumanError("load", { area: "book catalogue" })} backHref="/estab/library" />
        </Card>
      ) : (
        <IssueBookForm books={issuableBooks} defaultBookId={searchParams?.bookId} />
      )}

      <Card title="Loans">
        {issuesErrored && issues.length === 0 ? (
          // GAP-ESTAB-LIBRARY-ISSUES-04: a failed loans fetch gets a retryable
          // error state, not a bare badge, so an outage is not mistaken for
          // "no loans yet".
          <RefreshErrorState error={toHumanError("load", { area: "loans" })} backHref="/estab/library" />
        ) : issues.length === 0 ? (
          <EmptyState icon="📖" title="No loans yet" message="Issued books will appear here." />
        ) : (
          <IssuesTable rows={issues} />
        )}
      </Card>
    </div>
  );
}
