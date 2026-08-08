import { ModuleHub } from "../../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Install console"
      description="Provisioning stages, module resolution and silo provisions."
      help="install"
      links={[
        { href: "/install", label: "Installer wizard", note: "Guided install steps" },
        {
          href: "/install/domain-packs",
          label: "Domain Packs (Stage 3)",
          note: "Browse & activate municipal-in-v1 → TL / PGR / Water drafts",
        },
        { href: "/install/stages", label: "Stages", note: "Install stages and progress" },
        { href: "/install/steps", label: "Steps", note: "Atomic install steps" },
        { href: "/install/modules", label: "Modules", note: "Module resolution catalogue" },
        { href: "/install/silos", label: "Silo provisions", note: "Isolated tenant silo provisions" },
      ]}
    />
  );
}
