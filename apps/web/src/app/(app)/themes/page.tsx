import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Themes"
      description="Design tokens, templates and branding for tenant editions."
      help="themes"
      links={[
        { href: "/themes/tokens", label: "Tokens", note: "Colour and scalar design tokens" },
        { href: "/themes/templates", label: "Templates", note: "Theme templates" },
        { href: "/themes/branding", label: "Branding", note: "Branding packs and logos" },
        { href: "/themes/brand", label: "Brand preset", note: "Active brand and presets" },
        { href: "/settings/branding", label: "Settings branding", note: "Tenant settings branding editor" },
      ]}
    />
  );
}
