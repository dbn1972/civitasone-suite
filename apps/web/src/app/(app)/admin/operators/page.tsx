import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSAOperators } from "@/app/_data/loaders";
import { OperatorsTable } from "./OperatorsTable";

export default async function OperatorsPage() {
  const { data: operators, source } = await getSAOperators();
  const active = operators.filter((o) => String(o.status ?? o.twoFaStatus ?? "").toLowerCase() !== "suspended" && String(o.status ?? o.twoFaStatus ?? "").toLowerCase() !== "disabled").length;
  const twoFa = operators.filter((o) => String(o.twoFaStatus ?? "").toLowerCase() === "enabled").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Platform Operators" subtitle="Super admin and platform team accounts with access controls." back="/admin" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
      <StatGrid>
        <StatCard icon="👤" iconBg="#eef2ff" label="Total Operators" value={operators.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="🔐" iconBg="#fffaeb" label="2FA Enabled" value={twoFa} />
        <StatCard icon="⛔" iconBg="#fce7ee" label="Suspended" value={operators.length - active} />
      </StatGrid>
      <Card title="Operator Directory">
        <OperatorsTable operators={operators} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
