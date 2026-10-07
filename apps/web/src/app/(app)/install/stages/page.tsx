import Link from "next/link";
import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getInstallStages } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getInstallStages();
  return (
    <div className="page-main">
      {/* GAP-INSTALL-STAGES-05: removed the duplicate local Breadcrumb landmark;
          the global AutoBreadcrumb supplies Home / Install / Stages. */}
      <ModuleListPage
        title="Stages"
        description="Installer stages from install-service. Stage 3 activates a Domain Pack (Municipal India → Trade License, grievances, Water drafts)."
        rows={data}
        source={source}
        back="/install/console"
        backLabel="Install console"
        errorArea="install stages"
      />
      {/* GAP-INSTALL-STAGES-04: this list is read-only. Run / retry / skip of
          steps lives in the wizard; Stage 3 activation on the Domain Packs page.
          Link to both rather than adding stage-level mutations with no backend
          endpoint. */}
      <p className="back" style={{ marginTop: 16 }}>
        <Link href="/install">Run or retry steps in the installer wizard →</Link>
        {" · "}
        <Link href="/install/domain-packs">Open Domain Pack activation (Stage 3) →</Link>
      </p>
    </div>
  );
}
