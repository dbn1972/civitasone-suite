import Link from "next/link";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getLegalCases } from "../../../_data/loaders";
import { LegalCasesTable } from "./LegalCasesTable";
import { isWritOrCriminal, ACTIVE_CASE_STATUSES } from "./caseHelpers";

export default async function LegalCasesListPage() {
  const { data: items, source } = await getLegalCases();

  // GAP-LEGAL-LIST-02: "active" means any live matter — pending, appealed or
  // stayed — not only status==="pending" (which dropped appealed/stayed cases
  // the table itself knows about). Shared constant so page and table agree.
  const active = items.filter((i) => ACTIVE_CASE_STATUSES.includes(i.status)).length;
  const courts = new Set(items.map((i) => i.court)).size;
  const disposed = items.filter((i) => i.status === "disposed").length;
  // GAP-LEGAL-LIST-01: this counts writ/criminal matters — a case category,
  // not a computed risk assessment. Labelled honestly as "Writ / Criminal"
  // and driven by the same predicate the table's filter uses so the card and
  // filter counts can never diverge.
  const writOrCriminal = items.filter(isWritOrCriminal).length;

  return (
    <div className="wrap">
      <PageHeader
        title="Legal Cases"
        subtitle="Track litigation across courts & tribunals."
        actions={
          <>
            <Link href="/legal/hearings" className="btn ghost">Cause list</Link>
            <Link href="/legal/cases/new" className="btn primary">+ New Case</Link>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📁" iconBg="#f1f5f9" label="Active Cases" value={active} />
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Courts / Fora" value={courts} />
        {/* GAP-LEGAL-LIST-02: all-time disposed; no FY disposal date on the
            summary payload to filter on, so the card is labelled honestly. */}
        <StatCard icon="✅" iconBg="#ecfdf3" label="Disposed" value={disposed} />
        {/* GAP-LEGAL-LIST-01: category count, not a risk score. */}
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Writ / Criminal" value={writOrCriminal} />
      </div>
      {/* UX-012: the data-source badge now lives inside LegalCasesTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <LegalCasesTable items={items} source={source} />
    </div>
  );
}
