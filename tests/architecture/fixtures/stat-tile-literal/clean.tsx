// Fixture: the real #1472 FIX shape -- every stat tile is bound to a real
// loader/prop-derived value, or this app's own honest "—" placeholder, plus
// one deliberately-static value carrying the "static reference" escape
// hatch. Lives under tests/architecture/fixtures/, not apps/web/src, so the
// guard's own file walk never scans it directly -- the test reads its text
// and passes it to checkStatTileLiteralViolations() instead.
import { StatCard } from "@/app/_components/ds";
import { StatCardGrid } from "@/app/_components/StatCardGrid";

interface Props {
  tenants: number;
  uptime: string | undefined;
  servicesLabel: string;
  rows: Array<{ label: string; value: string }>;
}

export default function CleanFixturePage({ tenants, uptime, servicesLabel, rows }: Props) {
  return (
    <main>
      <h1>Platform Overview</h1>
      <p>Live counts pulled from the admin service every load.</p>
      <button type="button">Refresh</button>

      <StatCard icon="🏢" iconBg="#eef2ff" label="Active Tenants" value={tenants} />
      <StatCard icon="💚" iconBg="#fffaeb" label="Platform Uptime" value={uptime ?? "—"} />
      <StatCard icon="📊" iconBg="#eff6ff" label="Services" value={servicesLabel} />
      <StatCardGrid items={rows.map((r) => ({ label: r.label, value: r.value }))} />

      {/* static reference: fixed policy constant, genuinely the same for every tenant */}
      <StatCard icon="⏰" iconBg="#f5f5f5" label="Std Hours" value="8 hrs" />
    </main>
  );
}
