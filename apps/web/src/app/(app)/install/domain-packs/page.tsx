import { PageShell } from "../../../_components/PageShell";
import { DomainPackActivatePanel } from "../DomainPackActivatePanel";

export const dynamic = "force-dynamic";

export default function DomainPacksInstallPage() {
  return (
    <PageShell
      title="Install — Domain Packs"
      description="Stage 3: browse Domain Packs and activate municipal-in-v1 to import TL, PGR, and Water as editable drafts."
    >
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-slate-600">
        ← <a href="/install/console">Install console</a>
        {" · "}
        <a href="/install">Installer wizard</a>
      </nav>
      <DomainPackActivatePanel variant="page" />
    </PageShell>
  );
}
