/**
 * V4-G-08 (follow-up) -- the citizen receipt journal must use a journal type that the database
 * accepts. gl.finance_journals.type has a CHECK constraint (latest definition: migration 0077);
 * the consumer used "citizen_receipt", which is not in it, so every posting would be refused by the
 * database even when the revenue and bank heads exist.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const m = vi.hoisted(() => ({ spine: vi.fn(async (..._a: unknown[]) => "journal-id") }));
vi.mock("../../shared/db.js", () => {
  const tx = async (cb: (t: unknown) => Promise<void>) => { await cb({}); };
  return { scopedRead: tx, db: { transaction: tx } };
});
vi.mock("../../shared/outbox.js", () => ({ enqueue: vi.fn(async () => undefined), markProcessed: vi.fn(async () => true) }));
vi.mock("../../shared/infra.js", () => ({ cache: { invalidateResource: vi.fn(async () => undefined) } }));
vi.mock("../budget/repo.js", () => ({ findHeadByCodeTx: async (_t: unknown, _x: string, code: string) => ({ id: `head-${code}`, code }) }));
vi.mock("../gl/spine.js", () => ({ enqueueSpineJournal: m.spine }));

import { registerRevenueGlConsumers } from "./consumer.js";
import { CONSUMED_EVENTS } from "../../topics.js";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../../migrations");

/** The allowed list of the most recent migration that (re)defines finance_journals_type_check. */
function allowedJournalTypes(): Set<string> {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let latest: string[] = [];
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    const at = sql.indexOf("ADD CONSTRAINT finance_journals_type_check");
    if (at === -1) continue;
    const list = /CHECK\s*\(\s*type\s+IN\s*\(([^)]*)\)/s.exec(sql.slice(at));
    if (list) latest = [...list[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
  }
  return new Set(latest);
}

describe("revenue-gl journal type", () => {
  it("posts the citizen receipt under a type accepted by finance_journals_type_check", async () => {
    let handler: ((msg: unknown) => Promise<void>) | undefined;
    registerRevenueGlConsumers({ subscribe: (_t: string, h: (msg: unknown) => Promise<void>) => { handler = h; } } as never);
    await handler!({
      messageId: "m1", tenantId: "t1", actorId: "a1", correlationId: "c1",
      payload: { id: "p1", applicationId: "app1", receiptNo: "RCT-2026-00000001", amountMinor: "100" },
    });
    expect(CONSUMED_EVENTS.citizenReceiptIssued).toBe("citizen.receipt.issued");
    const type = (m.spine.mock.calls[0]![1] as { type: string }).type;
    expect(allowedJournalTypes().size).toBeGreaterThan(10);
    expect(allowedJournalTypes().has(type)).toBe(true);
  });
});
