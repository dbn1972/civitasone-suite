import { PageHeader } from "@/app/_components/ds";
import { getInstallSteps } from "../../../_data/loaders";
import { InstallStepsLog } from "../InstallStepsLog";

export const dynamic = "force-dynamic";

export default async function Page() {
  // GAP-INSTALL-STEPS-04: use the TYPED install-steps loader (InstallStepSummary
  // carries stepNo/isRequired/errorMessage/completedAt), not the generic
  // ModuleRowSummary mapper that flattened those fields away. The view below is
  // a read-only log; run/retry/skip stays in the installer wizard (/install).
  const { data, source } = await getInstallSteps();
  return (
    <div className="page-main">
      {/* GAP-INSTALL-STEPS-05: the global AutoBreadcrumb (AppShell TopBar)
          supplies the Home / Install / Steps trail, so there is no duplicate
          local <nav aria-label="Breadcrumb"> landmark; the back affordance is
          the PageHeader's own next/link. */}
      <PageHeader
        title="Steps"
        subtitle="Full installer step list from install-service, with status and any errors."
        back="/install/console"
        backLabel="Install console"
      />
      <InstallStepsLog steps={data} source={source} />
    </div>
  );
}
