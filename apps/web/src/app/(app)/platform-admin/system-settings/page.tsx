import { PageHeader, StatCard } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { SystemSettingsPage } from "./SystemSettingsPage";

export default function SystemSettingsRoute() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "System Settings" }]} />
      <PageHeader
        back="/platform-admin"
        title="System Settings"
        subtitle="General, Email, Security, and Integration configuration for the platform."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🏢" iconBg="#eff6ff" label="General" value="Configured" />
        <StatCard icon="📧" iconBg="#ecfdf3" label="Email (SMTP)" value="smtp.nic.in" />
        <StatCard icon="🛡️" iconBg="#fef3f2" label="Security" value="MFA on" />
        <StatCard icon="🔗" iconBg="#fffaeb" label="Integrations" value="3 connected" />
      </div>
      <SystemSettingsPage />
    </main>
  );
}
