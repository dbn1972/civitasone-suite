import { describe, it, expect } from "vitest";
import { reconcile, type MasterRow, type PendingOp } from "./pendingMaster";

const row = (o: Partial<MasterRow> & { code: string }): MasterRow => ({ label: o.code, active: true, sortOrder: 0, ...o });

describe("reconcile (stale read after a 202)", () => {
  it("keeps a just-created row visible while the server read still lacks it", () => {
    const pending: PendingOp<MasterRow>[] = [{ kind: "upsert", row: row({ code: "new_one", label: "New One" }) }];
    const stale = reconcile([row({ id: "1", code: "a" })], pending);
    expect(stale.rows.map((r) => r.code)).toContain("new_one");
    expect(stale.remaining).toHaveLength(1);
    const fresh = reconcile([row({ id: "1", code: "a" }), row({ id: "2", code: "new_one", label: "New One" })], pending);
    expect(fresh.remaining).toHaveLength(0);
    expect(fresh.rows).toHaveLength(2);
  });

  it("does not let a stale read revert an edit, and settles once the server has it", () => {
    const pending: PendingOp<MasterRow>[] = [{ kind: "upsert", row: row({ id: "1", code: "a", label: "Renamed" }) }];
    const stale = reconcile([row({ id: "1", code: "a", label: "Old" })], pending);
    expect(stale.rows[0]!.label).toBe("Renamed");
    expect(stale.remaining).toHaveLength(1);
    expect(reconcile([row({ id: "1", code: "a", label: "Renamed" })], pending).remaining).toHaveLength(0);
  });

  it("does not let a stale read resurrect a deleted row, and settles once it is gone", () => {
    const pending: PendingOp<MasterRow>[] = [{ kind: "delete", id: "1" }];
    const stale = reconcile([row({ id: "1", code: "a" })], pending);
    expect(stale.rows).toHaveLength(0);
    expect(stale.remaining).toHaveLength(1);
    expect(reconcile([], pending).remaining).toHaveLength(0);
  });
});
