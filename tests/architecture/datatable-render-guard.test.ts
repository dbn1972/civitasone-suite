/**
 * datatable-render-guard.mjs — fixture-based unit tests.
 *
 * Exercises the exported `checkSourceForRenderGuardViolation()` directly
 * against in-memory source strings, mirroring
 * tests/architecture/stat-tile-literal-guard.test.ts's shape.
 *
 * Run: pnpm exec vitest run tests/architecture/datatable-render-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import { checkSourceForRenderGuardViolation } from "../../scripts/ci/datatable-render-guard.mjs";

describe("datatable-render-guard: checkSourceForRenderGuardViolation()", () => {
  it("flags a Server Component (no 'use client') that passes render: to DataTable (the GAP-HR-EXPENSES-01 / PR #1647 shape)", () => {
    const source = `
import { DataTable } from "@/app/_components/ds";

export default async function Page() {
  const columns = [
    { key: "amount", label: "Amount", render: (r) => formatINR(r.amount) },
  ];
  return <DataTable columns={columns} rows={[]} />;
}
`;
    expect(checkSourceForRenderGuardViolation(source)).not.toBeNull();
  });

  it("reports the 1-based line number of the render: definition", () => {
    const source = [
      `import { DataTable } from "@/app/_components/ds";`,
      ``,
      `export default async function Page() {`,
      `  const columns = [`,
      `    { key: "amount", label: "Amount", render: (r) => r.amount },`,
      `  ];`,
      `  return <DataTable columns={columns} rows={[]} />;`,
      `}`,
    ].join("\n");
    expect(checkSourceForRenderGuardViolation(source)).toBe(5);
  });

  it("does not flag a Client Component ('use client' first) using render: with DataTable", () => {
    const source = `"use client";
import { DataTable } from "@/app/_components/ds";

export function Table({ rows }) {
  const columns = [
    { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
  ];
  return <DataTable columns={columns} rows={rows} />;
}
`;
    expect(checkSourceForRenderGuardViolation(source)).toBeNull();
  });

  it("accepts single-quoted 'use client' with no trailing semicolon", () => {
    const source = `'use client'
import { DataTable } from "@/app/_components/ds";
const columns = [{ key: "x", label: "X", render: (r) => r.x }];
export const T = () => <DataTable columns={columns} rows={[]} />;
`;
    expect(checkSourceForRenderGuardViolation(source)).toBeNull();
  });

  it("allows blank lines before the 'use client' directive", () => {
    const source = `

"use client";
import { DataTable } from "@/app/_components/ds";
const columns = [{ key: "x", label: "X", render: (r) => r.x }];
export const T = () => <DataTable columns={columns} rows={[]} />;
`;
    expect(checkSourceForRenderGuardViolation(source)).toBeNull();
  });

  it("does NOT treat 'use client' as effective when something else precedes it (matches Next.js's own rule)", () => {
    const source = `import { foo } from "bar";
"use client";
import { DataTable } from "@/app/_components/ds";
const columns = [{ key: "x", label: "X", render: (r) => r.x }];
export const T = () => <DataTable columns={columns} rows={[]} />;
`;
    expect(checkSourceForRenderGuardViolation(source)).not.toBeNull();
  });

  it("does not flag a file with render: but no DataTable import at all (unrelated render prop)", () => {
    const source = `
export default function Page() {
  const columns = [{ key: "x", label: "X", render: (r) => r.x }];
  return <SomeOtherTable columns={columns} />;
}
`;
    expect(checkSourceForRenderGuardViolation(source)).toBeNull();
  });

  it("does not flag a DataTable consumer with no render: at all (cellType-only columns)", () => {
    const source = `
import { DataTable } from "@/app/_components/ds";
export default async function Page() {
  const columns = [{ key: "amount", label: "Amount", cellType: "amount" }];
  return <DataTable columns={columns} rows={[]} />;
}
`;
    expect(checkSourceForRenderGuardViolation(source)).toBeNull();
  });

  it("ignores a render: mention that only appears inside a comment", () => {
    const source = `
import { DataTable } from "@/app/_components/ds";
// carry a \`render: (r) => formatMoney(r.amount)\` closure -- DataTable is a
// Client Component, so this can't be passed from a Server Component.
export default async function Page() {
  const columns = [{ key: "amount", label: "Amount", cellType: "amount" }];
  return <DataTable columns={columns} rows={[]} />;
}
`;
    expect(checkSourceForRenderGuardViolation(source)).toBeNull();
  });

  it("ignores a render: mention that only appears inside a block comment", () => {
    const source = `
import { DataTable } from "@/app/_components/ds";
/*
 * render: (r) => formatMoney(r.amount) -- explained here, not real code.
 */
export default async function Page() {
  const columns = [{ key: "amount", label: "Amount", cellType: "amount" }];
  return <DataTable columns={columns} rows={[]} />;
}
`;
    expect(checkSourceForRenderGuardViolation(source)).toBeNull();
  });
});
