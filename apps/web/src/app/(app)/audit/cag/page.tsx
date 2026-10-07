import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getCagParas } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { CagTable } from "./CagTable";

export default async function CagPage() {
  const result = await getCagParas();
  const { data: paras, source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  // GAP-AUDIT-CAG-01: derive KPIs from the real per-paragraph statuses instead
  // of summing fabricated per-row totals. "Paragraphs" is the row count;
  // Settled / Pending are counts of the settled vs not-settled statuses.
  const totalParas = errored ? null : paras.length;
  const settled = errored ? null : paras.filter((p) => p.status === "settled").length;
  const pending = errored ? null : paras.filter((p) => p.status !== "settled").length;
  // GAP-AUDIT-CAG-04: ignore rows with no department before counting distinct
  // departments, so a missing/blank department does not count as one.
  const departments = errored ? null : new Set(paras.map((p) => p.department).filter((d): d is string => !!d)).size;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="CAG Audit Interaction"
        subtitle="Comptroller and Auditor General audit paragraphs and settlement tracking."
        back="/audit"
      />

      <StatGrid>
        <StatCard icon="📜" iconBg="#eef2ff" label="Paragraphs" value={totalParas ?? "—"} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Settled" value={settled ?? "—"} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label="Pending" value={pending ?? "—"} />
        <StatCard icon="🏛️" iconBg="#fce7ee" label="Departments" value={departments ?? "—"} />
      </StatGrid>

      {errored ? (
        <Card title="CAG Audit Paragraphs">
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "CAG audit paragraphs" })} backHref="/audit" />
          </div>
        </Card>
      ) : paras.length === 0 ? (
        <Card title="CAG Audit Paragraphs">
          <EmptyState
            icon="📜"
            title="No CAG paragraphs found"
            message="CAG audit paragraphs will appear here once reported by the audit team."
          />
        </Card>
      ) : (
        <Card title="CAG Audit Paragraphs">
          <CagTable rows={paras} source={source} />
        </Card>
      )}
    </div>
  );
}
