import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../src/modules/sla/", import.meta.url);

describe("F3 leftover helpdesk calendar CQRS", () => {
  it("calendar-routes has zero sync Drizzle writes / db.transaction", async () => {
    const source = await readFile(new URL("calendar-routes.ts", ROOT), "utf8");
    expect(source).not.toMatch(/\b(?:db|tx)\.(?:insert|update|delete)\s*\(/);
    expect(source).not.toMatch(/db\.transaction/);
    expect(source).toContain("sendAccepted");
    expect(source).toContain("commands.createCalendar");
    expect(source).toContain("commands.pauseSla");
    expect(source).toContain("commands.submitCes");
  });

  it("sla consumer markProcessed precedes calendar insert", async () => {
    const source = await readFile(new URL("consumer.ts", ROOT), "utf8");
    const idx = source.indexOf("COMMANDS.calendarCreate");
    const mp = source.indexOf("markProcessed", idx);
    const insert = source.indexOf("tx.insert(businessCalendars)", idx);
    expect(mp).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(mp);
  });
});
