import { PageHeader } from "../../../_components/ds";
import { getLoyaltyPrograms } from "../_data";
import { ProgramsTable } from "./ProgramsTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function Page({ searchParams }: { searchParams?: { page?: string } }) {
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const { data, source } = await getLoyaltyPrograms({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Loyalty — Programs"
        subtitle="Loyalty programmes from loyalty-service."
        back="/loyalty"
        backLabel="Loyalty Programs"
      />
      <ProgramsTable rows={data} source={source} />
    </div>
  );
}
