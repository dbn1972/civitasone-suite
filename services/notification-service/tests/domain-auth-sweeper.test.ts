/**
 * sweepDomainAuthChecks must rotate through all enabled domains when there are more than `limit` of them
 * (CLOS3-S5-24): an unordered LIMIT re-checks the same arbitrary subset forever.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = { id: string; tenantId: string; domain: string; enabled: boolean; lastCheckedAt: Date | null;
  dkimSelector: string; dkimValue: string; spfInclude: string; dmarcPolicy: string };

const H = vi.hoisted(() => ({ rows: [] as unknown[], orderByCalls: 0 }));

vi.mock("../src/shared/scanner-db.js", () => ({
  scannerDb: {
    select: () => ({
      from: () => ({
        where: () => {
          let ordered = false;
          const node = {
            orderBy: () => { H.orderByCalls += 1; ordered = true; return node; },
            limit: async (n: number) => {
              const rows = [...(H.rows as Row[])];
              if (ordered) {
                // Emulates: ORDER BY last_checked_at ASC NULLS FIRST, id
                rows.sort((a, b) => {
                  const at = a.lastCheckedAt?.getTime() ?? -Infinity;
                  const bt = b.lastCheckedAt?.getTime() ?? -Infinity;
                  return at === bt ? a.id.localeCompare(b.id) : at < bt ? -1 : 1;
                });
              }
              return rows.slice(0, n);
            },
          };
          return node;
        },
      }),
    }),
  },
}));
vi.mock("../src/modules/email/dns.js", () => ({
  probeDomainAuth: async () => ({ dkimTxt: null, spfTxt: null, dmarcTxt: null }),
  nodeDnsResolver: {},
}));

import { sweepDomainAuthChecks } from "../src/modules/email/sweeper.js";

describe("domain auth sweeper rotation", () => {
  beforeEach(() => {
    H.orderByCalls = 0;
    H.rows = Array.from({ length: 150 }, (_, i): Row => ({
      id: `d${String(i).padStart(3, "0")}`, tenantId: "t1", domain: `d${i}.example.test`, enabled: true,
      lastCheckedAt: null, dkimSelector: "s", dkimValue: "v", spfInclude: "i", dmarcPolicy: "none",
    }));
  });

  it("covers all 150 domains across two sweeps of 100 and orders the query", async () => {
    const seen = new Set<string>();
    const queue = {
      publish: vi.fn(async (_t: string, m: { payload: { sendingDomainId: string } }) => {
        seen.add(m.payload.sendingDomainId);
        // Simulate the consumer rolling the check result onto the domain row.
        const row = (H.rows as Row[]).find((r) => r.id === m.payload.sendingDomainId)!;
        row.lastCheckedAt = new Date();
      }),
    } as never;

    expect(await sweepDomainAuthChecks(queue, {} as never, 100)).toBe(100);
    expect(await sweepDomainAuthChecks(queue, {} as never, 100)).toBe(100);
    expect(H.orderByCalls).toBe(2);
    expect(seen.size).toBe(150);
  });
});
