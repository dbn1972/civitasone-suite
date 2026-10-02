import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSAOperators } from "@/app/_data/loaders";
import { OperatorsTable } from "./OperatorsTable";
import { summariseOperators } from "./operatorStatus";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ADMIN_PLATFORM_ROLES } from "@/lib/auth/adminRoles";

export default async function OperatorsPage() {
  // GAP-ADMIN-OPERATORS-01: platform-operator console.
  requireAnyRole(ADMIN_PLATFORM_ROLES);
  const { data: operators, source } = await getSAOperators();
  const { active, suspended, unknown } = summariseOperators(operators);
  const twoFa = operators.filter((o) => String(o.twoFaStatus ?? "").toLowerCase() === "enabled").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside OperatorsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <PageHeader title="Platform Operators" subtitle="Super admin and platform team accounts with access controls." back="/admin" />
      <StatGrid>
        <StatCard icon="👤" iconBg="#eef2ff" label="Total Operators" value={operators.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="🔐" iconBg="#fffaeb" label="2FA Enabled" value={twoFa} />
        <StatCard icon="⛔" iconBg="#fce7ee" label="Suspended" value={suspended} />
        {unknown > 0 && <StatCard icon="❔" iconBg="#f1f5f9" label="Status unknown" value={unknown} />}
      </StatGrid>
      <Card title="Operator Directory">
        <OperatorsTable operators={operators} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
