import { describe, it, expect, vi } from "vitest";

const dataTableProps = vi.fn();
vi.mock("../../../_components/ds", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, DataTable: (props: unknown) => { dataTableProps(props); return null; } };
});
vi.mock("../_data", () => ({
  getFieldAgentsDetailed: async () => ({ data: [{ agentId: "a-1", taskCount: 3 }, { agentId: "a-2", taskCount: 1 }], source: "api" }),
}));

import Page from "./page";

/** Every function anywhere in a props object (columns' render, rowKey, ...). */
function functionProps(value: unknown, path = "props"): string[] {
  if (typeof value === "function") return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => functionProps(v, `${path}[${i}]`));
  if (value && typeof value === "object" && !("$$typeof" in (value as object))) {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => functionProps(v, `${path}.${k}`));
  }
  return [];
}

describe("/field/agents (UAT Phase 1B: Server Component passed a function prop to DataTable)", () => {
  it("passes DataTable only serialisable props, with a stable per-agent row id", async () => {
    const { render } = await import("@testing-library/react");
    render(await Page());
    const props = dataTableProps.mock.calls[0]![0] as { rows: Array<Record<string, unknown>> };
    expect(functionProps(props)).toEqual([]);
    expect(props.rows.map((r) => [r.id, r.count])).toEqual([["a-1", 3], ["a-2", 1]]);
  });
});
