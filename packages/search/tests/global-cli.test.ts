import { describe, it, expect, vi, afterEach } from "vitest";
import { runGlobalSearchCli, type BackfillEntity } from "../src/global/index.js";

const T = "11111111-1111-4111-8111-111111111111";
const idN = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function entities(n: number): (t: string) => BackfillEntity[] {
  const rows = Array.from({ length: n }, (_, i) => ({ id: idN(i + 1) }));
  return (tenantId) => [{
    entityType: "finance.vendor",
    source: {
      tenantId,
      idOf: (r: { id: string }) => r.id,
      fetchPage: async (after: string | null, size: number) => rows.filter((r) => after === null || r.id > after).slice(0, size),
      toRecord: (r: { id: string }) => ({ entityType: "finance.vendor" as const, entityId: r.id, tenantId, title: `V ${r.id.slice(-3)}`, status: "active" }),
    },
  }];
}
const fakeIndex = () => ({ initialize: vi.fn().mockResolvedValue(undefined), upsert: vi.fn().mockResolvedValue(1), removeTenant: vi.fn().mockResolvedValue(2), waitForTask: vi.fn().mockResolvedValue(undefined) });

describe("reindex:global-search driver", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it("defaults to a dry run and never touches the engine", async () => {
    const idx = fakeIndex(); const out: string[] = [];
    const [r] = await runGlobalSearchCli(["--tenant", T], entities(7), { out: (l) => out.push(l) }, idx);
    expect(r).toMatchObject({ dryRun: true, scanned: 7, indexed: 7 });
    expect(idx.initialize).not.toHaveBeenCalled(); expect(idx.upsert).not.toHaveBeenCalled();
    expect(out.join("\n")).toMatch(/DRY RUN finance.vendor.*would-index=7/);
  });
  it("--apply writes; --limit caps and prints the resume cursor; the second run completes it", async () => {
    const idx = fakeIndex(); const out: string[] = [];
    const [a] = await runGlobalSearchCli(["--tenant", T, "--apply", "--limit", "4"], entities(7), { out: (l) => out.push(l) }, idx);
    expect(a).toMatchObject({ scanned: 4, done: false, lastId: idN(4) });
    expect(out.join("\n")).toContain(`--only finance.vendor --after ${idN(4)}`);
    const [b] = await runGlobalSearchCli(["--tenant", T, "--apply", "--only", "finance.vendor", "--after", idN(4)], entities(7), { out: () => undefined }, idx);
    expect(b).toMatchObject({ scanned: 3, done: true });
    expect(idx.upsert.mock.calls.flatMap((c) => c[0]).length).toBe(7);
  });
  it("--purge is a dry run without --apply, and removes only the named tenant with it", async () => {
    const idx = fakeIndex();
    await runGlobalSearchCli(["--tenant", T, "--purge"], entities(1), { out: () => undefined }, idx);
    expect(idx.removeTenant).not.toHaveBeenCalled();
    await runGlobalSearchCli(["--tenant", T, "--purge", "--apply"], entities(1), { out: () => undefined }, idx);
    expect(idx.removeTenant).toHaveBeenCalledWith(T);
  });
  it("rejects an unknown --only and a missing tenant", async () => {
    await expect(runGlobalSearchCli(["--tenant", T, "--only", "hrms.salary"], entities(1), { out: () => undefined }, fakeIndex())).rejects.toThrow(/unknown entity type/);
    await expect(runGlobalSearchCli([], entities(1), { out: () => undefined }, fakeIndex())).rejects.toThrow(/--tenant/);
  });
});
