import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Plugins"
      description="Installed plugins, marketplace catalogue, hooks and registry."
      help="plugins"
      links={[
        { href: "/plugins/installed", label: "Installed", note: "Enable or disable tenant plugins" },
        { href: "/plugins/marketplace", label: "Marketplace", note: "Discover and install plugins" },
        { href: "/plugins/hooks", label: "Hooks", note: "Plugin event hooks" },
        { href: "/plugins/registry", label: "Registry", note: "Registered plugin catalogue" },
      ]}
    />
  );
}
