import { PageHeader } from "../../../_components/ds";
import { getLoyaltyMembers } from "../_data";
import { MembersTable } from "./MembersTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function Page({ searchParams }: { searchParams?: { page?: string; programId?: string } }) {
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const { data, source } = await getLoyaltyMembers({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    ...(searchParams?.programId ? { programId: searchParams.programId } : {}),
  });
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Loyalty — Members"
        subtitle="Member enrolments with tier status and point balances."
        back="/loyalty"
        backLabel="Loyalty Programs"
      />
      <MembersTable rows={data} source={source} variant="members" />
    </div>
  );
}
