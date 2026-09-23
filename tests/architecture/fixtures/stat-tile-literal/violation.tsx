// Fixture: modeled directly on the real #1472 defect (Super Admin dashboard
// "stop fabricating uptime/services metrics") plus a StatCardGrid-shaped
// variant of the same bug. Every stat tile below is a hardcoded literal
// standing in for a value nothing ever fetches -- this file exists ONLY to
// prove stat-tile-literal-guard.mjs catches this shape (see
// tests/architecture/stat-tile-literal-guard.test.ts). It lives under
// tests/architecture/fixtures/, not apps/web/src, so the guard's own file
// walk never scans it directly -- the test reads its text and passes it to
// checkStatTileLiteralViolations() instead.
import { StatCard } from "@/app/_components/ds";
import { StatCardGrid } from "@/app/_components/StatCardGrid";

export default function ViolationFixturePage() {
  return (
    <main>
      <StatCard icon="💚" iconBg="#fffaeb" label="Platform Uptime" value="99.9%" />
      <StatCard icon="📊" iconBg="#eff6ff" label="Services" value="33" />
      <StatCardGrid
        items={[
          { label: "Active Tenants", value: "128" },
          { label: "Error Rate", value: "0.2%" },
        ]}
      />
    </main>
  );
}
