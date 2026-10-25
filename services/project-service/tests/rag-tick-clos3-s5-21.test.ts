/**
 * CLOS3-S5-21: RAG tick -- (A) no overlapping ticks, (B) milestones loaded once per tenant
 * (not per project), (C) keyset paging so projects beyond the page limit are covered.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  listActiveProjects: vi.fn(),
  listMilestonesByProjects: vi.fn(),
  listMilestonesByProject: vi.fn(),
  updateProjectRagStatusTx: vi.fn(),
  updateMilestoneTx: vi.fn(),
}));
vi.mock("../src/modules/project/repo.js", () => m);
vi.mock("../src/shared/db.js", () => ({ db: { transaction: async (cb: (tx: unknown) => unknown) => cb({}) } }));
vi.mock("../src/shared/infra.js", () => ({ cache: { invalidate: vi.fn(async () => undefined), makeKey: (...a: string[]) => a.join(":") } }));

import { runRagTick, _resetRagState } from "../src/modules/project/rag.js";

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const proj = (n: number, tenantId = T1) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, tenantId, status: "active", rag: "green",
  physicalPct: "10", financialPct: "10", endDate: null,
});

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.listMilestonesByProjects.mockResolvedValue([]);
  _resetRagState();
});

describe("runRagTick", () => {
  it("(A) a second concurrent tick is skipped while the first is still running", async () => {
    let release!: () => void;
    m.listActiveProjects.mockReturnValueOnce(new Promise((r) => { release = () => r([]); }));
    const first = runRagTick(10);
    const second = await runRagTick(10);
    expect(second).toEqual({ scanned: 0, flipped: 0, skipped: true });
    expect(m.listActiveProjects).toHaveBeenCalledTimes(1);
    release();
    await first;
    // guard released: the next tick runs
    m.listActiveProjects.mockResolvedValueOnce([]);
    expect((await runRagTick(10)).skipped).toBeUndefined();
  });

  it("(A) the busy flag is released even when a tick throws", async () => {
    m.listActiveProjects.mockRejectedValueOnce(new Error("db down"));
    await expect(runRagTick(10)).rejects.toThrow("db down");
    m.listActiveProjects.mockResolvedValueOnce([]);
    expect((await runRagTick(10)).skipped).toBeUndefined();
  });

  it("(B) loads milestones with one query per tenant, not one per project", async () => {
    const projects = [proj(1), proj(2), proj(3), proj(4, T2)];
    m.listActiveProjects.mockResolvedValueOnce(projects);
    await runRagTick(100);
    expect(m.listMilestonesByProject).not.toHaveBeenCalled();
    expect(m.listMilestonesByProjects).toHaveBeenCalledTimes(2);
    expect(m.listMilestonesByProjects).toHaveBeenCalledWith(projects.slice(0, 3).map((p) => p.id), T1);
    expect(m.listMilestonesByProjects).toHaveBeenCalledWith([projects[3]!.id], T2);
  });

  it("(B) an overdue milestone from the batch still turns its project red/delayed", async () => {
    const p = proj(1);
    m.listActiveProjects.mockResolvedValueOnce([p]);
    m.listMilestonesByProjects.mockResolvedValueOnce([{ id: "ms1", projectId: p.id, tenantId: T1, status: "pending", plannedDate: "2000-01-01" }]);
    const out = await runRagTick(100);
    expect(out.flipped).toBe(1);
    expect(m.updateProjectRagStatusTx).toHaveBeenCalledWith(expect.anything(), p.id, { rag: "red", status: "delayed" });
    expect(m.updateMilestoneTx).toHaveBeenCalledWith(expect.anything(), "ms1", { status: "delayed" });
  });

  it("(C) pages by id across ticks, covers everything, then wraps to the start", async () => {
    const all = [proj(1), proj(2), proj(3)];
    m.listActiveProjects.mockImplementation(async (limit: number, after?: string | null) =>
      all.filter((p) => after == null || p.id > after).slice(0, limit));
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      m.listMilestonesByProjects.mockClear();
      await runRagTick(2);
      for (const call of m.listMilestonesByProjects.mock.calls) seen.push(...(call[0] as string[]));
    }
    // tick1: p1,p2 ; tick2: p3 (short page => cursor reset) ; tick3: p1,p2 again
    expect(seen).toEqual([all[0]!.id, all[1]!.id, all[2]!.id, all[0]!.id, all[1]!.id]);
    expect(m.listActiveProjects.mock.calls[0]).toEqual([2, null]);
    expect(m.listActiveProjects.mock.calls[1]).toEqual([2, all[1]!.id]);
    expect(m.listActiveProjects.mock.calls[2]).toEqual([2, null]);
  });
});
