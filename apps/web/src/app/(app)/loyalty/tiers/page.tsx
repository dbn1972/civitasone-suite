import Link from "next/link";
import { PageHeader } from "../../../_components/ds";
import { getLoyaltyTiers } from "../_data";
import { TiersTable } from "./TiersTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function Page({ searchParams }: { searchParams?: { page?: string; programId?: string } }) {
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const { data, source } = await getLoyaltyTiers({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    ...(searchParams?.programId ? { programId: searchParams.programId } : {}),
  });
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Loyalty — Tiers"
        subtitle="Tier definitions — name, points threshold, and benefits — per programme."
        back="/loyalty"
        backLabel="Loyalty Programs"
      />
      {/* GAP-LOYALTY-TIERS-02: tiers are configured as part of a programme;
          point the user to where that happens instead of leaving the indirect
          "via programme configuration" wording with no link. */}
      <p className="muted" style={{ margin: "4px 0 12px", fontSize: 13 }}>
        Tiers are defined within each programme. Manage them from{" "}
        <Link href="/loyalty/programs">Programmes</Link>.
      </p>
      <TiersTable rows={data} source={source} />
    </div>
  );
}
