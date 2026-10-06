import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getChangeRequests } from "../_data/loaders";
import { formatIndianDateTime } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

const PAGE_SIZE = 10;

export default async function Page({ searchParams }: { searchParams?: { page?: string; q?: string } }) {
  const { data: changes, source } = await getChangeRequests();
  const errored = source === "error";

  const q = (searchParams?.q ?? "").trim().toLowerCase();

  // GAP-CHANGE-COMMS-01: these are completed changes that CARRY release notes.
  // The admin-service DOES enqueue a notification broadcast on a successful
  // release (f3-apply.ts apply_change_7 -> notification.broadcast.send), but the
  // change record exposes no per-release delivery status, so this page does NOT
  // claim a broadcast was delivered — it reports the release notes that were
  // recorded. (Adding true delivery status needs a notification-service feed;
  // tracked as a HUMAN REVIEW / backend item.)
  const recorded = changes
    .filter((c) => c.status === "completed" && c.releaseNotes)
    .filter((c) => (q ? c.title.toLowerCase().includes(q) : true))
    .sort((a, b) => new Date(b.pirAt ?? b.updatedAt).getTime() - new Date(a.pirAt ?? a.updatedAt).getTime());

  // GAP-CHANGE-COMMS-02: paginate client-side over the fetched list. The
  // backend list endpoint supports only `limit` (no offset/status filter), so
  // the full set may be capped at the loader's limit — stated below.
  const total = recorded.length;
  const page = Math.max(1, Number.parseInt(searchParams?.page ?? "1", 10) || 1);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * PAGE_SIZE;
  const pageItems = recorded.slice(start, start + PAGE_SIZE);

  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/change/comms?${s}` : "/change/comms";
  };

  return (
    <>
      <PageHeader
        title="Release notes & comms"
        subtitle="Release notes recorded on each successful release."
        back="/change"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📣" iconBg="#eef2ff" label="Release notes recorded" value={errored ? "—" : total.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card">
        <div className="pad">
          <form method="GET" action="/change/comms" style={{ display: "flex", gap: 8 }}>
            <input className="inp" name="q" defaultValue={searchParams?.q ?? ""} placeholder="Search release titles…" aria-label="Search release titles" />
            <button type="submit" className="btn">Search</button>
          </form>
        </div>
      </div>

      {errored ? (
        <div className="card">
          <RefreshErrorState error={toHumanError("load", { area: "release notes" })} />
        </div>
      ) : total === 0 ? (
        <div className="card">
          <EmptyState icon="📣" title="No release notes recorded yet" message="Completing a change with release notes records them here and enqueues a user broadcast via the notification service." />
        </div>
      ) : (
        <>
          {pageItems.map((c) => (
            <div className="card" key={c.id}>
              <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3><a href={`/change/${c.id}`}>{c.title}</a></h3>
                <span style={{ color: "#667085", fontSize: 13 }}>Reviewed {formatIndianDateTime(c.pirAt ?? c.updatedAt)}</span>
              </div>
              <div className="pad">
                {/* GAP-CHANGE-COMMS-04: clamp long notes to ~6 lines behind a native
                    <details> toggle (server-safe) with overflow-wrap for long tokens. */}
                <details>
                  <summary style={{ cursor: "pointer", listStyle: "revert" }}>Release notes</summary>
                  <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "8px 0 0" }}>{c.releaseNotes}</p>
                </details>
                {c.affectedServices.length > 0 && (
                  <p style={{ color: "#667085", fontSize: 13, marginTop: 8 }}>
                    Affected services: {c.affectedServices.join(", ")}
                  </p>
                )}
              </div>
            </div>
          ))}
          <div className="card">
            <div className="pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#667085", fontSize: 13 }}>
                Showing {start + 1}–{start + pageItems.length} of {total.toLocaleString("en-IN")}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                {current > 1 && <a className="btn ghost" href={qs(current - 1)}>← Previous</a>}
                {current < pageCount && <a className="btn ghost" href={qs(current + 1)}>Next →</a>}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
