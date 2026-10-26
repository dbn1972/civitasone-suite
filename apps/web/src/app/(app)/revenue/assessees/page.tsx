import Link from "next/link";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState, Button } from "@/app/_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { AssesseesTable, type AssesseeRow } from "./AssesseesTable";
import { AssesseeCreateForm } from "./AssesseeCreateForm";

// GAP-REVENUE-ASSESSEES-04: the register is paginated and searched on the server
// (?q=&page=) so a large register is neither loaded whole nor silently truncated.
const PAGE_SIZE = 15;

type Summary = { total: number; property: number; waterConnection: number; other: number; active: number };
type AssesseePage = { rows: AssesseeRow[]; total: number; summary: Summary | null };

function toCount(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function mapPage(p: unknown): AssesseePage | null {
  const arr = Array.isArray(p) ? p : (p as { data?: AssesseeRow[] })?.data;
  if (!Array.isArray(arr)) return null;
  const meta = (p as { meta?: { total?: unknown; summary?: Record<string, unknown> } })?.meta;
  const s = meta?.summary;
  return {
    rows: arr,
    total: typeof meta?.total === "number" ? meta.total : arr.length,
    summary: s
      ? {
          total: toCount(s.total),
          property: toCount(s.property),
          waterConnection: toCount(s.waterConnection),
          other: toCount(s.other),
          active: toCount(s.active),
        }
      : null,
  };
}

async function getAssessees(q: string, page: number): Promise<LoaderResult<AssesseePage>> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
  if (q) params.set("q", q);
  return fetchJson<unknown, AssesseePage>(
    `/api/v1/revenue/assessees?${params.toString()}`,
    { rows: [], total: 0, summary: null },
    { telemetryKey: "revenue.assessees.list", mapResponse: mapPage },
  );
}

function pageHref(q: string, page: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/revenue/assessees?${qs}` : "/revenue/assessees";
}

export default async function AssesseesPage(props?: { searchParams?: Promise<{ q?: string; page?: string }> }) {
  const sp = (await props?.searchParams) ?? {};
  const q = (sp.q ?? "").trim().slice(0, 100);
  const parsedPage = Number.parseInt(sp.page ?? "1", 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const { data, source } = await getAssessees(q, page);
  // GAP-REVENUE-ASSESSEES-01: a failed fetch defaults to an empty page, which
  // would otherwise render a false "0 registered assessees". Treat an error
  // source as "unknown", not "zero".
  const isError = source === "error";
  const { rows: assessees, total, summary } = data;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Assessee Register"
        subtitle="Property and water-connection taxpayers registered for municipal revenue collection."
        back="/revenue"
        actions={isError ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="🧾" tone="info" label="Registered Assessees" value={isError ? null : (summary?.total ?? total)} />
        <StatCard icon="🏠" tone="warn" label="Property Assessees" value={isError ? null : (summary?.property ?? 0)} />
        <StatCard icon="🚰" tone="info" label="Water-Connection Assessees" value={isError ? null : (summary?.waterConnection ?? 0)} />
        {/* GAP-REVENUE-ASSESSEES-02: Property + Water + Trade & Other reconciles to Registered. */}
        <StatCard icon="🏪" tone="neutral" label="Trade & Other" value={isError ? null : (summary?.other ?? 0)} />
        <StatCard icon="✅" tone="good" label="Active" value={isError ? null : (summary?.active ?? 0)} />
      </StatGrid>

      <AssesseeCreateForm />

      <Card title="Assessees">
        <form method="GET" role="search" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="assessee-search" style={{ fontSize: 13, fontWeight: 600 }}>
              Search register
            </label>
            <input
              id="assessee-search"
              name="q"
              type="search"
              defaultValue={q}
              maxLength={100}
              placeholder="Owner name or identifier…"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, minWidth: 260 }}
            />
          </div>
          <Button type="submit" style={{ minHeight: 44 }}>
            Search
          </Button>
          {q ? <Link href="/revenue/assessees">Clear search</Link> : null}
        </form>
        {isError ? (
          <RefreshErrorState error={toHumanError("load", { area: "assessees" })} backHref="/revenue" />
        ) : (
          <>
            <AssesseesTable assessees={assessees} searching={q.length > 0} />
            {total > PAGE_SIZE ? (
              <nav aria-label="Assessee pages" style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 12 }}>
                {page > 1 ? <Link href={pageHref(q, page - 1)} rel="prev">Previous</Link> : null}
                <span>
                  Page {page} of {lastPage} · {total} assessees
                </span>
                {page < lastPage ? <Link href={pageHref(q, page + 1)} rel="next">Next</Link> : null}
              </nav>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
