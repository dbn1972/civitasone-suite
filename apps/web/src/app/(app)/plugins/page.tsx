import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Plugins"
      description="Install and manage plugins, browse the marketplace, and review hooks and the plugin registry."
      help="plugins"
      columns="four"
      links={[
        {
          href: "/plugins/installed",
          label: "Installed",
          note: "Plugins provisioned for your organisation — enable or disable them",
        },
        {
          href: "/plugins/marketplace",
          label: "Marketplace",
          note: "Browse plugins available to install for your organisation",
        },
        { href: "/plugins/hooks", label: "Hooks", note: "Business events plugins subscribe to" },
        {
          href: "/plugins/registry",
          label: "Registry",
          note: "Catalogue of registered plugin definitions and versions",
        },
      ]}
    />
  );
}
