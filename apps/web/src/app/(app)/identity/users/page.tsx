import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getIdentityUsers } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getIdentityUsers();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/identity">Identity</a>
      </nav>
      <ModuleListPage
        title="Identity — Users"
        description="Users from identity-service."
        rows={data}
        source={source}
      />
    </div>
  );
}
