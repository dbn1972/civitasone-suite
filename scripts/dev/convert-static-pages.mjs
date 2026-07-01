#!/usr/bin/env node
/**
 * Codemod: convert remaining static HR pages (const items: Row[] = [...]) to
 * async server components that fetch from the backend API. On 404/error, they
 * gracefully show an empty table — no crash.
 */
import { readFileSync, writeFileSync } from "node:fs";

const PAGES = {
  "apps/web/src/app/(app)/hr/benefits/page.tsx": "/api/v1/hrms/benefits",
  "apps/web/src/app/(app)/hr/certifications/page.tsx": "/api/v1/hrms/certifications",
  "apps/web/src/app/(app)/hr/checkin-log/page.tsx": "/api/v1/hrms/attendance/checkin-log",
  "apps/web/src/app/(app)/hr/confirmation/page.tsx": "/api/v1/hrms/confirmations",
  "apps/web/src/app/(app)/hr/directory/page.tsx": "/api/v1/hrms/employees?limit=200",
  "apps/web/src/app/(app)/hr/goals/page.tsx": "/api/v1/hrms/goals",
  "apps/web/src/app/(app)/hr/grievance/page.tsx": "/api/v1/hrms/grievances",
  "apps/web/src/app/(app)/hr/onboarding/page.tsx": "/api/v1/hrms/onboarding",
  "apps/web/src/app/(app)/hr/outsourced/page.tsx": "/api/v1/hrms/employees?limit=50",
  "apps/web/src/app/(app)/hr/payroll/arrears/page.tsx": "/api/v1/payroll/arrears",
  "apps/web/src/app/(app)/hr/payroll/income-tax/page.tsx": "/api/v1/payroll/income-tax",
  "apps/web/src/app/(app)/hr/payroll/period/page.tsx": "/api/v1/finance/periods",
  "apps/web/src/app/(app)/hr/payroll/statutory/page.tsx": "/api/v1/payroll/statutory-deductions",
  "apps/web/src/app/(app)/hr/service-book/page.tsx": "/api/v1/hrms/service-book",
  "apps/web/src/app/(app)/hr/shift-requests/page.tsx": "/api/v1/hrms/shift-requests",
  "apps/web/src/app/(app)/hr/skills/page.tsx": "/api/v1/hrms/skills",
  "apps/web/src/app/(app)/hr/staffing-plan/page.tsx": "/api/v1/hrms/staffing-plan",
  "apps/web/src/app/(app)/hr/training/feedback/page.tsx": "/api/v1/hrms/training/feedback",
  "apps/web/src/app/(app)/hr/training/nominations/page.tsx": "/api/v1/hrms/training/nominations",
  "apps/web/src/app/(app)/hr/vigilance/page.tsx": "/api/v1/hrms/vigilance",
  "apps/web/src/app/(app)/hr/wfh/page.tsx": "/api/v1/hrms/wfh-requests",
};

let converted = 0;

for (const [file, endpoint] of Object.entries(PAGES)) {
  try {
    const src = readFileSync(file, "utf8");
    if (!src.includes("const items:") && !src.includes("const items =")) continue;
    if (src.includes("fetchJson")) { console.log(`SKIP (already converted): ${file}`); continue; }

    // Extract the type Row definition
    const rowTypeMatch = src.match(/type Row = \{[\s\S]*?\}\s*&\s*Record<string,\s*unknown>/);
    const rowType = rowTypeMatch ? rowTypeMatch[0] : 'type Row = Record<string, unknown>';

    // Extract columns definition
    const colsMatch = src.match(/const columns[\s\S]*?(?=\];)\];/);
    const cols = colsMatch ? colsMatch[0] : '  const columns: { key: string; label: string; cellType?: "status" }[] = [];';

    // Extract the component function name
    const fnMatch = src.match(/export default (?:async )?function (\w+)/);
    const fnName = fnMatch ? fnMatch[1] : "Page";

    // Extract PageHeader props
    const headerMatch = src.match(/<PageHeader[^>]*title="([^"]*)"[^>]*subtitle="([^"]*)"[^>]*/);
    const title = headerMatch ? headerMatch[1] : fnName.replace(/Page$/, "");
    const subtitle = headerMatch ? headerMatch[2] : "";
    const backMatch = src.match(/back="([^"]*)"/);
    const back = backMatch ? backMatch[1] : "/hr";

    // Extract stat computations (simplified — just keep the pattern)
    const telemetryKey = endpoint.replace("/api/v1/hrms/", "hr.").replace("/api/v1/payroll/", "payroll.").replace("/api/v1/finance/", "finance.").replace(/[\/?&=]/g, "_");

    const newSrc = `import { PageHeader, StatGrid, StatCard, DataTable } from "${file.includes('/payroll/') || file.includes('/training/') ? '../../../../' : '../../../'}_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

${rowType};

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("${endpoint}", [], {
    telemetryKey: "${telemetryKey}",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function ${fnName}() {
  const items = await getData();

  ${cols}

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="${title}" subtitle="${subtitle}" back="${back}" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total" value={items.length} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter…" pageSize={15} />
      </div>
    </main>
  );
}
`;
    writeFileSync(file, newSrc, "utf8");
    converted++;
    console.log(`OK: ${file}`);
  } catch (err) {
    console.log(`ERR: ${file} — ${err.message}`);
  }
}

console.log(`\nConverted ${converted} pages.`);
