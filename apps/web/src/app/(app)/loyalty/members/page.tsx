import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getLoyaltyMembers } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getLoyaltyMembers();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/loyalty">Loyalty Programs</a>
      </nav>
      <ModuleListPage
        title="Loyalty — Members"
        description="Member enrolments and tier status."
        rows={data}
        source={source}
      />
    </main>
  );
}
