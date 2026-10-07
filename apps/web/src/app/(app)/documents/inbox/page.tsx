import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { EmptyState, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { getDocumentInbox, getDocumentStats } from "../_data/loaders";
import type { DakSummary } from "../_data/types";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate, formatInternalRef, humanizeStatus, istDatePart, todayIST } from "@/lib/formatters";

// GAP-DOCUMENTS-INBOX-05: strings come from the `documentsInbox` i18n namespace
// (next-intl is the single i18n system for apps/web — see src/i18n/config.ts),
// so headers/labels switch with the active locale (en/hi parity enforced).
type T = Awaited<ReturnType<typeof getTranslations>>;

function priorityPill(p: string) {
  if (p === "urgent") return "bad";
  if (p === "high") return "warn";
  return "good";
}

function statusPill(s: string) {
  if (s === "acknowledged") return "good";
  if (s === "forwarded") return "warn";
  if (s === "pending") return "warn";
  return "mut";
}

/**
 * GAP-DOCUMENTS-INBOX-03: a dak is overdue when its due date is before today
 * (compared in IST calendar days to avoid an off-by-one around midnight) and
 * it has not yet been acknowledged. An acknowledged dak is never flagged.
 */
export function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === "acknowledged") return false;
  const due = istDatePart(dueDate);
  if (!due) return false;
  return due < todayIST();
}

/**
 * GAP-DOCUMENTS-INBOX-04: never print a raw user UUID (PII / id leakage). The
 * documents module has no user-name lookup wired in, so until one exists we
 * show a short, non-identifying reference token rather than the full uuid.
 */
export function assigneeLabel(assignedTo: string | null): string {
  if (!assignedTo) return "—";
  const short = assignedTo.replace(/-/g, "").slice(0, 6);
  return short ? `User ${short}` : "—";
}

function DakRow({ dak, t }: { dak: DakSummary; t: T }) {
  const overdue = isOverdue(dak.dueDate, dak.status);
  return (
    <tr>
      <td>{formatInternalRef(dak.id)}</td>
      <td style={{ maxWidth: 300 }}>
        <Link href={`/documents/inbox/${dak.id}`}><strong>{dak.subject}</strong></Link>
      </td>
      <td>
        <span className={`pill ${priorityPill(dak.priority)}`}>{humanizeStatus(dak.priority)}</span>
      </td>
      <td>
        <span className={`pill ${statusPill(dak.status)}`}>{humanizeStatus(dak.status)}</span>
      </td>
      <td className={overdue ? "bad" : undefined}>
        {formatIndianDate(dak.dueDate)}
        {overdue && <span className="pill bad" style={{ marginInlineStart: 6 }}>{t("overdue")}</span>}
      </td>
      <td>{assigneeLabel(dak.assignedTo)}</td>
      <td>{formatIndianDate(dak.createdAt)}</td>
      <td>
        <Link href={`/documents/inbox/${dak.id}`} className="btn" style={{ padding: "4px 10px", fontSize: 13 }}>{t("view")}</Link>
      </td>
    </tr>
  );
}

export default async function DocumentInboxPage() {
  const t = await getTranslations("documentsInbox");
  const [{ data: items, source }, { data: stats, source: statsSource }] = await Promise.all([
    getDocumentInbox(),
    getDocumentStats(),
  ]);

  const errored = source === "error";
  // GAP-DOCUMENTS-INBOX-02: KPI tiles are driven by the inbox summary (which
  // counts the whole user-scoped inbox) rather than items.length, which is the
  // (page-capped) number of rows actually fetched for the table. When the
  // summary itself failed, fall back to the loaded-page counts so a tile still
  // shows something rather than a dash.
  const statsOk = statsSource !== "error";
  const total = statsOk ? stats.inboxCount : errored ? null : items.length;
  const urgent = statsOk ? stats.inboxUrgentCount : errored ? null : items.filter((d) => d.priority === "urgent").length;
  const pending = statsOk ? stats.inboxPendingCount : errored ? null : items.filter((d) => d.status === "pending").length;
  const forwarded = statsOk ? stats.inboxForwardedCount : errored ? null : items.filter((d) => d.status === "forwarded").length;

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}

      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Link href="/documents/library" className="btn">{t("libraryAction")}</Link>
        }
      />

      <StatGrid>
        <StatCard icon="📥" iconBg="var(--panel)" label={t("statTotal")} value={total === null ? "—" : total.toLocaleString("en-IN")} />
        <StatCard icon="⚡" iconBg="var(--panel)" label={t("statUrgent")} value={urgent === null ? "—" : urgent.toLocaleString("en-IN")} />
        <StatCard icon="⏳" iconBg="var(--panel)" label={t("statPending")} value={pending === null ? "—" : pending.toLocaleString("en-IN")} />
        <StatCard icon="➡️" iconBg="var(--panel)" label={t("statForwarded")} value={forwarded === null ? "—" : forwarded.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>{t("cardHeading")}</h3></div>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: t("errorArea") })} />
        ) : items.length === 0 ? (
          <EmptyState icon="📥" title={t("emptyTitle")} message={t("emptyMessage")} />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">{t("colReference")}</th>
                  <th scope="col">{t("colSubject")}</th>
                  <th scope="col">{t("colPriority")}</th>
                  <th scope="col">{t("colStatus")}</th>
                  <th scope="col">{t("colDue")}</th>
                  <th scope="col">{t("colAssigned")}</th>
                  <th scope="col">{t("colCreated")}</th>
                  <th scope="col">{t("colAction")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => <DakRow key={d.id} dak={d} t={t} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
