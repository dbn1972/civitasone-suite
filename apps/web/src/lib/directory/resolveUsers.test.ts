import { describe, it, expect, vi, beforeEach } from "vitest";

// resolveUsers imports @/app/_data/apiClient (next/headers, server-only); mock
// it so we can test the batching/mapping/fail-soft logic in jsdom.
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import { resolveUsers, userDisplayLabel } from "./resolveUsers";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("resolveUsers (server directory helper)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("returns an empty map (no request) for no valid ids", async () => {
    const map = await resolveUsers(["not-a-uuid", ""]);
    expect(map.size).toBe(0);
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("resolves ids to a name map and hits the directory ids endpoint", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [[UUID_A, "Asha Rao"], [UUID_B, "Bimal Das"]],
      source: "api",
    });
    const map = await resolveUsers([UUID_A, UUID_B, UUID_A /* dup */]);
    expect(map.get(UUID_A)).toBe("Asha Rao");
    expect(map.get(UUID_B)).toBe("Bimal Das");
    expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("/v1/identity/users/directory?ids=");
  });

  it("fail-soft: a loader error leaves the id unresolved (absent from the map)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    const map = await resolveUsers([UUID_A]);
    expect(map.has(UUID_A)).toBe(false);
  });
});

describe("userDisplayLabel", () => {
  it("returns the name when the id resolves", () => {
    const map = new Map([[UUID_A, "Asha Rao"]]);
    expect(userDisplayLabel(map, UUID_A)).toBe("Asha Rao");
  });

  it("falls back to a short id (never a guess) when unresolved", () => {
    expect(userDisplayLabel(new Map(), UUID_A)).toBe("11111111…");
  });

  it("returns the empty fallback for a missing id", () => {
    expect(userDisplayLabel(new Map(), null)).toBe("—");
    expect(userDisplayLabel(new Map(), "", "none")).toBe("none");
  });
});
