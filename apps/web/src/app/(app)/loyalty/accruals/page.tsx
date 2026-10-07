import { PageHeader } from "../../../_components/ds";
import { getLoyaltyAccruals } from "../_data";
import { MembersTable } from "../members/MembersTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function Page({ searchParams }: { searchParams?: { page?: string } }) {
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const { data, source } = await getLoyaltyAccruals({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  return (
    <div className="page-main">
      <PageHeader
        title="Loyalty — Accruals"
        subtitle="Per-member points position: current balance and lifetime points earned."
        back="/loyalty"
        backLabel="Loyalty Programs"
      />
      <MembersTable rows={data} source={source} variant="accruals" />
    </div>
  );
}
