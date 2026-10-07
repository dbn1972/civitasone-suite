import { PageHeader } from "../../../_components/ds";
import { getLoyaltyRedemptions } from "../_data";
import { RedemptionsTable } from "./RedemptionsTable";
import { getSessionRoles, hasAnyRole, LOYALTY_ADMIN_ROLES } from "@/lib/auth/roleGuard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function Page({ searchParams }: { searchParams?: { page?: string } }) {
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const { data, source } = await getLoyaltyRedemptions({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const canManage = hasAnyRole(getSessionRoles(), LOYALTY_ADMIN_ROLES);
  return (
    <div className="page-main">
      <PageHeader
        title="Loyalty — Redemptions"
        subtitle="Point redemption history and reward fulfilment."
        back="/loyalty"
        backLabel="Loyalty Programs"
      />
      <RedemptionsTable rows={data} source={source} canManage={canManage} />
    </div>
  );
}
