import Link from "next/link";
import { PageHeader, Card, EmptyState, StatusPill, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { getCasesPage } from "../_data/loaders";
import { CASE_STATUSES } from "../_data/types";
import { casePillStatus, fmtDate, humanize, isOverdue } from "../_data/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--ink2)",
  textAlign: "left",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};

const srOnly: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};

function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export default async function CasesListPage({
  searchParams,
}: {
  searchParams: { page?: string; status?: string; q?: string };
}) {
  const statusParam =
    searchParams.status && (CASE_STATUSES as readonly string[]).includes(searchParams.status)
      ? searchParams.status
      : undefined;
  const query = (searchParams.q ?? "").trim();
  const page = Math.max(toPositiveInt(searchParams.page, 1), 1);
  const offset = (page - 1) * PAGE_SIZE;

  const result = await getCasesPage({ status: statusParam, q: query || undefined, limit: PAGE_SIZE, offset });
  const source = result.source;
  const { cases, total } = result.data;

  // Search is applied server-side (title / CNR / filing number), so pagination
  // and the total reflect the filter and a match beyond page 1 is reachable.
  const rows = cases;

  const countLabel = source === "error" ? "—" : total.toLocaleString("en-IN");
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + cases.length, total);
  const hasPrev = page > 1;
  const hasNext = offset + cases.length < total;

  const linkTo = (p: number) => {
    const sp = new URLSearchParams();
    if (statusParam) sp.set("status", statusParam);
    if (query) sp.set("q", query);
    sp.set("page", String(p));
    return `/court/cases?${sp.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Case Registry"
        subtitle="Every registered matter. Open a case to see parties, drive its lifecycle, schedule hearings and issue orders."
        back="/court"
        backLabel="Court"
      />

      <Card title={`All cases (${countLabel})`} padding>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "cases" })} backHref="/court" source={{ status: result.status, area: "cases" }} />
        ) : (
          <>
            <form method="GET" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>Status</span>
                <select name="status" defaultValue={statusParam ?? ""} className="inp" style={{ minWidth: 160 }}>
                  <option value="">All statuses</option>
                  {CASE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {humanize(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, flex: "1 1 220px" }}>
                <span style={{ fontWeight: 600 }}>Search this page</span>
                <input
                  name="q"
                  type="search"
                  defaultValue={query}
                  placeholder="Title, CNR or filing number"
                  className="inp"
                />
              </label>
              <button type="submit" className="btn primary sm">
                Apply
              </button>
              {(statusParam || query) && (
                <Link href="/court/cases" className="btn ghost sm">
                  Clear
                </Link>
              )}
            </form>

            {total === 0 ? (
              <EmptyState
                icon="🗂️"
                title="No cases yet"
                message="Matters registered by the filing counter will appear here."
              />
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, fontSize: 13, color: "var(--ink2)" }}>
                  <span>
                    Showing {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
                  </span>
                  {query && <span>Filtered by “{query}”</span>}
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="tbl court-stack" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={labelStyle}>Case</th>
                        <th style={labelStyle}>Type</th>
                        <th style={labelStyle}>Filed</th>
                        <th style={labelStyle}>SLA target</th>
                        <th style={labelStyle}>Status</th>
                        <th style={labelStyle}>
                          <span style={srOnly}>Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((c) => {
                        const overdue = isOverdue(c.targetDisposalDate, c.status);
                        return (
                          <tr key={c.id}>
                            <td data-label="Case">
                              <div style={{ fontWeight: 600 }}>{c.title || "Untitled matter"}</div>
                              {c.cnrNumber && (
                                <div style={{ ...monoStyle, fontSize: 12, color: "var(--ink2)" }}>{c.cnrNumber}</div>
                              )}
                              {!c.title && c.filingNumber && (
                                <div style={{ ...monoStyle, fontSize: 12, color: "var(--ink2)" }}>
                                  Filing {c.filingNumber}
                                </div>
                              )}
                            </td>
                            <td data-label="Type">{humanize(c.caseType)}</td>
                            <td data-label="Filed" style={monoStyle}>
                              {fmtDate(c.filingDate)}
                            </td>
                            <td data-label="SLA target" style={monoStyle}>
                              <span style={overdue ? { fontWeight: 700, color: "var(--bad, #b91c1c)" } : undefined}>
                                {fmtDate(c.targetDisposalDate)}
                              </span>
                              {overdue && (
                                <span style={{ marginInlineStart: 8 }}>
                                  <StatusPill status="rejected" label="Overdue" />
                                </span>
                              )}
                            </td>
                            <td data-label="Status">
                              <StatusPill status={casePillStatus(c.status)} label={humanize(c.status)} />
                            </td>
                            <td data-label="" style={{ textAlign: "end" }}>
                              <Link className="btn ghost sm" href={`/court/cases/${c.id}`}>
                                Open case →
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {(hasPrev || hasNext) && (
                  <nav
                    aria-label="Case registry pages"
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}
                  >
                    {hasPrev ? (
                      <Link className="btn ghost sm" href={linkTo(page - 1)} rel="prev">
                        ← Previous
                      </Link>
                    ) : (
                      <span />
                    )}
                    <span style={{ fontSize: 13, color: "var(--ink2)" }}>Page {page}</span>
                    {hasNext ? (
                      <Link className="btn ghost sm" href={linkTo(page + 1)} rel="next">
                        Next →
                      </Link>
                    ) : (
                      <span />
                    )}
                  </nav>
                )}
              </>
            )}
          </>
        )}
      </Card>
    </>
  );
}
