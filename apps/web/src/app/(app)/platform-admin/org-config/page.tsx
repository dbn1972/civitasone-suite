import { PageHeader, StatCard } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { OrgConfigPage } from "./OrgConfigPage";

export default function OrgConfigRoute() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "Org Configuration" }]} />
      <PageHeader
        back="/platform-admin"
        title="Organisation Configuration"
        subtitle="Configure the Indian government org hierarchy — Ministry → Department → Division → Section → Unit."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Hierarchy levels" value={5} />
        <StatCard icon="📂" iconBg="#ecfdf3" label="Structure" value="GFR 2017" />
        <StatCard icon="🔗" iconBg="#f1f5f9" label="Reporting chain" value="Top-down" />
        <StatCard icon="✏️" iconBg="#fffaeb" label="Editable" value="Name + Order" />
      </div>
      <OrgConfigPage />
    </main>
  );
}
