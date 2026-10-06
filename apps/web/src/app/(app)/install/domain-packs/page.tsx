import Link from "next/link";
import { PageShell } from "../../../_components/PageShell";
import { DomainPackActivatePanel } from "../DomainPackActivatePanel";
import { getSessionRoles, hasAnyRole, INSTALL_OPERATE_ROLES } from "@/lib/auth/roleGuard";

export const dynamic = "force-dynamic";

export default function DomainPacksInstallPage() {
  const canOperate = hasAnyRole(getSessionRoles(), INSTALL_OPERATE_ROLES);
  return (
    <PageShell
      title="Domain Packs"
      description="Import ready-made service templates. Activating Municipal India imports Trade License, grievance, and Water Connection drafts for local review."
      breadcrumb={
        <>
          <Link href="/install/console">Install console</Link>
          {" · "}
          <Link href="/install">Installer wizard</Link>
        </>
      }
    >
      <DomainPackActivatePanel variant="page" canOperate={canOperate} />
    </PageShell>
  );
}
