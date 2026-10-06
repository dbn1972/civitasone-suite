import { describe, it, expect } from "vitest";
import { mapRows } from "./_data";

describe("identity mapRows — GAP-IDENTITY-*-04 (Detail/Meta) + API-KEYS-03 (secret id)", () => {
  it("does NOT fall Detail (sublabel) back to status — a row with only a status shows no Detail", () => {
    // On the old code sublabel = description ?? status ?? state ?? ..., so this
    // row's Detail duplicated its Status. New behaviour: no sublabel at all.
    const [row] = mapRows([{ id: "a", status: "active" }]);
    expect(row.status).toBe("active");
    expect(row.sublabel).toBeUndefined();
  });

  it("keeps a real descriptive field as Detail", () => {
    const [row] = mapRows([{ id: "a", status: "active", description: "Primary office key" }]);
    expect(row.sublabel).toBe("Primary office key");
  });

  it("formats an ISO instant in Meta as a readable Indian date (was raw ISO)", () => {
    const [row] = mapRows([{ id: "a", updatedAt: "2026-09-28T09:14:22Z" }]);
    expect(row.meta).toBe("28 Sep 2026");
    expect(row.meta).not.toContain("T");
  });

  it("prefers updatedAt over createdAt for Meta and formats it", () => {
    const [row] = mapRows([{ id: "a", createdAt: "2025-01-01T00:00:00Z", updatedAt: "2026-09-28T09:14:22Z" }]);
    expect(row.meta).toBe("28 Sep 2026");
  });

  it("passes non-ISO meta values (code / currency) through unchanged", () => {
    expect(mapRows([{ id: "a", code: "KEY-01" }])[0].meta).toBe("KEY-01");
    expect(mapRows([{ id: "b", currency: "INR" }])[0].meta).toBe("INR");
  });

  it("GAP-IDENTITY-API-KEYS-03: a secret under `key` is NEVER used as the row id", () => {
    // If a future regression returned secret material under `key` with no `id`,
    // the old fallback chain (id = id ?? key ?? ...) would have printed the
    // secret's first 8 chars in the ID column and cached it offline. The id now
    // falls back to code/name/… then a synthetic row-N, never `key`.
    const secret = "ak_live_prefix.supersecretmaterialvalue";
    const [row] = mapRows([{ key: secret, name: "ci-deploy" }]);
    expect(row.id).toBe("ci-deploy"); // name, not the secret
    expect(row.id).not.toContain("supersecret");
    expect(JSON.stringify(row)).not.toContain("supersecret");
  });

  it("falls back to a synthetic id (never `key`) when there is no safe id field", () => {
    const [row] = mapRows([{ key: "ak_live_x.secret" }]);
    expect(row.id).toBe("row-1");
    expect(JSON.stringify(row)).not.toContain("secret");
  });
});
